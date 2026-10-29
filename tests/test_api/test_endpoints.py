"""The API, driven through the real ASGI app with a scripted model.

Nothing is mocked below the transport: these exercise the routers, the SSE
encoding, the runner, the graph, the gate and the checkpointer together.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx
import pytest

from jarvis.agent.llm import ScriptedLLM
from jarvis.api.app import create_app
from jarvis.core.types import RiskLevel


async def read_sse(client: httpx.AsyncClient, url: str, payload: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Collect an SSE stream as ``(event name, data)`` pairs."""
    events: list[tuple[str, dict[str, Any]]] = []
    async with client.stream("POST", url, json=payload) as response:
        assert response.status_code == 200
        name: str | None = None
        async for line in response.aiter_lines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: ") and name:
                events.append((name, json.loads(line[6:])))
                name = None
    return events


def names(events: list[tuple[str, dict[str, Any]]]) -> list[str]:
    return [name for name, _ in events]


@pytest.fixture
async def client(request: pytest.FixtureRequest) -> AsyncIterator[httpx.AsyncClient]:
    """An app wired to whatever model the test asked for via ``@pytest.mark.script``."""
    marker = request.node.get_closest_marker("script")
    llm = ScriptedLLM(list(marker.args[0]) if marker else [])
    app = create_app(llm=llm)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=30) as http:
            http.llm = llm  # type: ignore[attr-defined]
            yield http


class TestHealthAndCapabilities:
    @pytest.mark.script([])
    async def test_health(self, client: httpx.AsyncClient) -> None:
        assert (await client.get("/health")).json() == {"status": "ok"}

    @pytest.mark.script([])
    async def test_capabilities_describe_the_policy_and_tools(self, client: httpx.AsyncClient) -> None:
        body = (await client.get("/api/capabilities")).json()
        assert body["policy"] == {"read": "auto", "write": "auto (pull request)", "destructive": "confirm"}
        assert set(body["capabilities"]) == {"github", "argocd", "k8s", "ghcr"}
        assert body["fake_tools"] is True


class TestLabOverview:
    @pytest.mark.script([])
    async def test_overview_aggregates_capabilities(self, client: httpx.AsyncClient) -> None:
        body = (await client.get("/api/lab/overview")).json()
        assert [n["name"] for n in body["nodes"]] == ["um790"]
        assert {a["name"] for a in body["apps"]} == {"trip-ai", "tickup"}
        assert body["unhealthy_pods"][0]["reason"] == "ImagePullBackOff"
        assert body["degraded"] is True
        assert body["errors"] == {}


class TestChat:
    @pytest.mark.script(
        [
            ScriptedLLM.call_many([("argocd__list_apps", {}), ("k8s__list_pods", {"only_unhealthy": True})]),
            ScriptedLLM.say("tickup is Degraded."),
        ]
    )
    async def test_question_streams_tools_then_an_answer(self, client: httpx.AsyncClient) -> None:
        session = (await client.post("/api/sessions")).json()["session_id"]

        events = await read_sse(client, "/api/chat", {"session_id": session, "message": "come sta tickup?"})

        assert names(events) == ["tool_call", "tool_call", "tool_result", "tool_result", "token", "done"]
        assert all(data["risk"] == "read" for name, data in events if name == "tool_call")

    @pytest.mark.script([ScriptedLLM.say("Ciao!")])
    async def test_chat_without_a_session_id_still_works(self, client: httpx.AsyncClient) -> None:
        events = await read_sse(client, "/api/chat", {"message": "ciao"})
        assert names(events) == ["token", "done"]


class TestModels:
    @pytest.mark.script([])
    async def test_without_a_gateway_the_default_is_the_only_choice(self, client: httpx.AsyncClient) -> None:
        body = (await client.get("/api/models")).json()

        assert body["default"] == "claude-opus-5"
        assert body["models"] == [{"id": "claude-opus-5", "provider": "anthropic", "available": True, "loaded": False}]
        assert body["budget"] is None

    @pytest.mark.script([ScriptedLLM.say("Ciao!")])
    async def test_the_chosen_model_reaches_the_llm(self, client: httpx.AsyncClient) -> None:
        await read_sse(client, "/api/chat", {"message": "ciao", "model": "claude-opus-5"})
        assert client.llm.requests[0]["model"] == "claude-opus-5"  # type: ignore[attr-defined]

    @pytest.mark.script([])
    async def test_an_unknown_model_is_a_400_before_anything_runs(self, client: httpx.AsyncClient) -> None:
        response = await client.post("/api/chat", json={"message": "ciao", "model": "gpt-5"})

        assert response.status_code == 400
        assert client.llm.requests == []  # type: ignore[attr-defined]


class TestApprovalFlow:
    SCRIPT = [
        ScriptedLLM.call("github__merge_pr", {"number": 12}, risk=RiskLevel.DESTRUCTIVE, text="Merging #12."),
        ScriptedLLM.say("Merged. ArgoCD will reconcile."),
    ]

    @pytest.mark.script(SCRIPT)
    async def test_destructive_call_suspends_and_closes_the_stream(self, client: httpx.AsyncClient) -> None:
        session = (await client.post("/api/sessions")).json()["session_id"]

        events = await read_sse(client, "/api/chat", {"session_id": session, "message": "mergia la PR 12"})

        assert names(events) == ["token", "approval_required"]
        approval = events[-1][1]
        assert approval["tool"] == "github__merge_pr"
        assert approval["args"] == {"number": 12}

    @pytest.mark.script(SCRIPT)
    async def test_a_reload_restores_the_pending_dialog(self, client: httpx.AsyncClient) -> None:
        session = (await client.post("/api/sessions")).json()["session_id"]
        await read_sse(client, "/api/chat", {"session_id": session, "message": "mergia la PR 12"})

        body = (await client.get(f"/api/sessions/{session}")).json()

        assert body["pending_approval"]["tool"] == "github__merge_pr"
        assert [t["role"] for t in body["turns"]] == ["user"]

    @pytest.mark.script(SCRIPT)
    async def test_approving_resumes_the_run(self, client: httpx.AsyncClient) -> None:
        session = (await client.post("/api/sessions")).json()["session_id"]
        events = await read_sse(client, "/api/chat", {"session_id": session, "message": "mergia la PR 12"})
        run_id = events[-1][1]["run_id"]

        resumed = await read_sse(client, f"/api/approvals/{run_id}", {"session_id": session, "approved": True})

        assert names(resumed) == ["tool_call", "tool_result", "token", "done"]
        assert (await client.get(f"/api/sessions/{session}")).json()["pending_approval"] is None

    @pytest.mark.script(SCRIPT)
    async def test_declining_records_the_decision(self, client: httpx.AsyncClient) -> None:
        session = (await client.post("/api/sessions")).json()["session_id"]
        events = await read_sse(client, "/api/chat", {"session_id": session, "message": "mergia la PR 12"})
        run_id = events[-1][1]["run_id"]

        resumed = await read_sse(client, f"/api/approvals/{run_id}", {"session_id": session, "approved": False})

        assert "tool_call" not in names(resumed)
        detail = (await client.get(f"/api/runs/{run_id}")).json()
        assert detail["approvals"] == [
            {
                "tool": "github__merge_pr",
                "args": {"number": 12},
                "why": detail["approvals"][0]["why"],
                "approved": False,
                "decided_at": detail["approvals"][0]["decided_at"],
            }
        ]

    @pytest.mark.script([])
    async def test_approving_nothing_is_an_error_not_a_crash(self, client: httpx.AsyncClient) -> None:
        session = (await client.post("/api/sessions")).json()["session_id"]

        events = await read_sse(client, "/api/approvals/run_nope", {"session_id": session, "approved": True})

        assert names(events) == ["error"]
        assert "Nothing is waiting" in events[0][1]["message"]


class TestAudit:
    @pytest.mark.script([ScriptedLLM.call("k8s__list_nodes", {}), ScriptedLLM.say("One node.")])
    async def test_a_run_is_recorded_with_its_tool_calls(self, client: httpx.AsyncClient) -> None:
        session = (await client.post("/api/sessions")).json()["session_id"]
        await read_sse(client, "/api/chat", {"session_id": session, "message": "quanti nodi?"})

        runs = (await client.get("/api/runs")).json()
        assert len(runs) == 1
        assert runs[0]["prompt"] == "quanti nodi?"
        assert runs[0]["tool_count"] == 1

        detail = (await client.get(f"/api/runs/{runs[0]['run_id']}")).json()
        assert detail["tool_calls"][0]["tool"] == "k8s__list_nodes"
        assert detail["tool_calls"][0]["risk"] == "read"
        assert detail["answer"] == "One node."

    @pytest.mark.script([])
    async def test_unknown_run_is_404(self, client: httpx.AsyncClient) -> None:
        assert (await client.get("/api/runs/nope")).status_code == 404
