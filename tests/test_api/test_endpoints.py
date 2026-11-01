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
from jarvis.agent.models import ModelCatalog
from jarvis.api.app import create_app
from jarvis.core.types import RiskLevel
from jarvis.settings import Settings


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
        assert set(body["capabilities"]) == {"github", "argocd", "k8s", "ghcr", "prometheus", "loki", "alertmanager"}
        assert body["fake_tools"] is True

    @pytest.mark.script([])
    async def test_capabilities_carry_schemas_and_sources(self, client: httpx.AsyncClient) -> None:
        body = (await client.get("/api/capabilities")).json()
        read_file = next(t for t in body["capabilities"]["github"] if t["name"] == "github__read_file")
        assert "path" in read_file["input_schema"]["required"]
        assert set(body["sources"]) == set(body["capabilities"])
        assert body["sources"]["github"] == {
            "mode": "fixtures",
            "missing": [],
            "about": "the only path Jarvis has to change anything",
        }
        assert body["usage"] == {} and body["usage_days"] == 7

    @pytest.mark.script([ScriptedLLM.call("k8s__list_nodes", {}), ScriptedLLM.say("One node.")])
    async def test_capabilities_count_calls_from_the_audit_log(self, client: httpx.AsyncClient) -> None:
        await read_sse(client, "/api/chat", {"message": "quanti nodi?"})

        usage = (await client.get("/api/capabilities")).json()["usage"]
        assert set(usage) == {"k8s__list_nodes"}
        assert usage["k8s__list_nodes"]["calls"] == 1
        assert usage["k8s__list_nodes"]["errors"] == 0


class TestAlerts:
    async def test_alerts_page(self, client: httpx.AsyncClient) -> None:
        body = (await client.get("/api/alerts")).json()
        assert len(body["alerts"]) == 3
        assert body["alerts"][-1]["name"] == "KubePodNotReady"  # the youngest of three warnings
        assert body["targets_down"] == [] and body["errors"] == {}

    async def test_brief_for_a_firing_alert(self, client: httpx.AsyncClient) -> None:
        body = (await client.get("/api/alerts/59917779b926e5e6/brief")).json()
        assert body["fingerprint"] == "59917779b926e5e6"
        assert "KubePodCrashLooping" in body["prompt"]
        assert "tickup-backend-5f7c8d9b6-qw3rt (container backend)" in body["prompt"]

    async def test_brief_for_a_resolved_alert_is_404(self, client: httpx.AsyncClient) -> None:
        assert (await client.get("/api/alerts/deadbeef/brief")).status_code == 404

    async def test_status_counts_firing_alerts(self, client: httpx.AsyncClient) -> None:
        assert (await client.get("/api/status")).json()["counts"]["alerts"] == 3

    async def test_unconfigured_alertmanager_degrades_one_source(self, client: httpx.AsyncClient, monkeypatch) -> None:
        from jarvis.exceptions import ConfigurationError
        from jarvis.tools import alertmanager

        def unconfigured() -> None:
            raise ConfigurationError("alertmanager is not configured: set JARVIS_ALERTMANAGER_URL")

        monkeypatch.setattr(alertmanager.provider, "get", unconfigured)

        response = await client.get("/api/alerts")
        assert response.status_code == 200
        assert "JARVIS_ALERTMANAGER_URL" in response.json()["errors"]["alertmanager.alerts"]

        status = (await client.get("/api/status")).json()
        assert status["counts"]["alerts"] == 0
        assert "alertmanager.alerts" not in status["errors"]


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
        assert body["models"] == [
            {"id": "claude-opus-5", "provider": "anthropic", "available": True, "loaded": False, "backend": ""}
        ]
        assert body["budget"] is None
        assert body["gateway"] is False
        assert body["gpu"] is None

    @pytest.mark.script([ScriptedLLM.say("Ciao!")])
    async def test_the_chosen_model_reaches_the_llm(self, client: httpx.AsyncClient) -> None:
        await read_sse(client, "/api/chat", {"message": "ciao", "model": "claude-opus-5"})
        assert client.llm.requests[0]["model"] == "claude-opus-5"  # type: ignore[attr-defined]

    @pytest.mark.script([])
    async def test_an_unknown_model_is_a_400_before_anything_runs(self, client: httpx.AsyncClient) -> None:
        response = await client.post("/api/chat", json={"message": "ciao", "model": "gpt-5"})

        assert response.status_code == 400
        assert client.llm.requests == []  # type: ignore[attr-defined]


def gpu_off(request: httpx.Request) -> httpx.Response:
    """A gateway offering one local model, and an Ollama that does not answer."""
    if request.url.host == "litellm":
        data = [
            {"model_name": "local/qwen3-30b", "litellm_params": {"model": "ollama_chat/qwen3:30b"}},
            {"model_name": "claude-haiku-4-5", "litellm_params": {"model": "anthropic/claude-haiku-4-5"}},
        ]
        return httpx.Response(200, json={"data": data})
    raise httpx.ConnectTimeout("no route")


class TestLocalModelOffline:
    @pytest.fixture
    def offline(self, client: httpx.AsyncClient) -> httpx.AsyncClient:
        settings = Settings(
            ANTHROPIC_API_KEY="sk-virtual", llm_gateway_url="http://litellm:4000", ollama_url="http://ollama:11434"
        )
        app = client._transport.app  # type: ignore[attr-defined]
        app.state.services.models = ModelCatalog(settings, transport=httpx.MockTransport(gpu_off))
        return client

    @pytest.mark.script([ScriptedLLM.say("Ciao!")])
    async def test_without_consent_nothing_runs(self, offline: httpx.AsyncClient) -> None:
        session = (await offline.post("/api/sessions")).json()["session_id"]

        events = await read_sse(
            offline, "/api/chat", {"session_id": session, "message": "ciao", "model": "local/qwen3-30b"}
        )

        assert events == [
            (
                "model_unavailable",
                {"type": "model_unavailable", "requested": "local/qwen3-30b", "fallback": "claude-haiku-4-5"},
            )
        ]
        assert offline.llm.requests == []  # type: ignore[attr-defined]
        assert (await offline.get(f"/api/sessions/{session}")).json()["turns"] == []

    @pytest.mark.script([ScriptedLLM.say("Ciao!")])
    async def test_with_consent_the_fallback_answers(self, offline: httpx.AsyncClient) -> None:
        payload = {"message": "ciao", "model": "local/qwen3-30b", "allow_fallback": True}

        events = await read_sse(offline, "/api/chat", payload)

        assert names(events) == ["token", "done"]
        assert offline.llm.requests[0]["model"] == "claude-haiku-4-5"  # type: ignore[attr-defined]

    @pytest.mark.script([ScriptedLLM.say("Ciao!")])
    async def test_the_audit_keeps_the_model_that_was_picked(self, offline: httpx.AsyncClient) -> None:
        await read_sse(offline, "/api/chat", {"message": "ciao", "model": "local/qwen3-30b", "allow_fallback": True})

        run = (await offline.get("/api/runs")).json()[0]

        assert run["model"] == "local/qwen3-30b"

    @pytest.mark.script([])
    async def test_the_catalog_reports_the_dead_probe(self, offline: httpx.AsyncClient) -> None:
        body = (await offline.get("/api/models")).json()

        assert body["gpu"]["up"] is False
        assert body["gpu"]["resident"] == []
        assert {m["id"]: m["backend"] for m in body["models"]}["local/qwen3-30b"] == "ollama_chat/qwen3:30b"


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

    @pytest.mark.script(SCRIPT)
    async def test_a_waiting_run_is_listed_until_decided(self, client: httpx.AsyncClient) -> None:
        session = (await client.post("/api/sessions")).json()["session_id"]
        events = await read_sse(client, "/api/chat", {"session_id": session, "message": "mergia la PR 12"})
        run_id = events[-1][1]["run_id"]

        waiting = (await client.get("/api/approvals")).json()
        assert waiting["durable"] is False
        assert [(p["run_id"], p["session_id"], p["tool"], p["args"]) for p in waiting["pending"]] == [
            (run_id, session, "github__merge_pr", {"number": 12})
        ]
        assert waiting["pending"][0]["prompt"] == "mergia la PR 12"
        assert (await client.get("/api/runs")).json()[0]["risk"] == "destructive"

        await read_sse(client, f"/api/approvals/{run_id}", {"session_id": session, "approved": True})

        settled = (await client.get("/api/approvals")).json()
        assert settled["pending"] == []
        assert [(d["run_id"], d["tool"], d["approved"]) for d in settled["decided"]] == [
            (run_id, "github__merge_pr", True)
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
        assert runs[0]["calls_by_risk"] == {"read": 1, "write": 0, "destructive": 0}
        assert runs[0]["risk"] == "read"
        assert runs[0]["pending"] is None
        assert runs[0]["model"] == "claude-opus-5"

        detail = (await client.get(f"/api/runs/{runs[0]['run_id']}")).json()
        assert detail["tool_calls"][0]["tool"] == "k8s__list_nodes"
        assert detail["tool_calls"][0]["risk"] == "read"
        assert detail["answer"] == "One node."

    @pytest.mark.script([])
    async def test_unknown_run_is_404(self, client: httpx.AsyncClient) -> None:
        assert (await client.get("/api/runs/nope")).status_code == 404


async def read_get_sse(client: httpx.AsyncClient, url: str) -> list[tuple[str, dict[str, Any]]]:
    """Collect a GET SSE stream that ends on its own."""
    events: list[tuple[str, dict[str, Any]]] = []
    async with client.stream("GET", url) as response:
        assert response.status_code == 200
        name: str | None = None
        async for line in response.aiter_lines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: ") and name:
                events.append((name, json.loads(line[6:])))
                name = None
    return events


class TestConsoleLogs:
    """The fake follows forever; ``previous`` and a finite stub end the stream."""

    @pytest.mark.script([])
    async def test_probes_are_hidden_by_default(self, client: httpx.AsyncClient) -> None:
        url = "/api/k8s/pods/tickup/tickup-backend-5f7c8d9b6-qw3rt/logs/stream?previous=true"
        texts = [data["text"] for name, data in await read_get_sse(client, url) if name == "line"]
        assert texts and not any("GET /health" in t for t in texts)
        assert any("/api/leagues" in t for t in texts)

    @pytest.mark.script([])
    async def test_probes_on_request(self, client: httpx.AsyncClient) -> None:
        url = "/api/k8s/pods/tickup/tickup-backend-5f7c8d9b6-qw3rt/logs/stream?previous=true&exclude_probes=false"
        events = await read_get_sse(client, url)
        assert any("GET /health" in data["text"] for name, data in events if name == "line")
        assert names(events)[-1] == "end"

    @pytest.mark.script([])
    async def test_one_shot_logs_filter_too(self, client: httpx.AsyncClient) -> None:
        body = (await client.get("/api/k8s/pods/tickup/tickup-backend-5f7c8d9b6-qw3rt/logs")).json()
        assert "GET /health" not in body["text"] and "/api/leagues" in body["text"]

    @pytest.mark.script([])
    async def test_workload_stream_tags_lines_with_their_pod(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from jarvis.tools.k8s.fake import FakeK8sClient

        async def finite(self: Any, namespace: str, pod: str, **_: Any) -> AsyncIterator[str]:
            yield 'INFO:     10.42.0.1:1 - "GET /health HTTP/1.1" 200 OK'
            yield f"hello from {pod}"

        monkeypatch.setattr(FakeK8sClient, "follow_logs", finite)
        events = await read_get_sse(client, "/api/k8s/workloads/tickup/tickup-backend/logs/stream")
        assert events[0][0] == "pods"
        pods = events[0][1]["pods"]
        lines = [data for name, data in events if name == "line"]
        assert {line["pod"] for line in lines} == set(pods)
        assert all(line["text"] == f"hello from {line['pod']}" for line in lines)
        assert names(events)[-1] == "end"

    @pytest.mark.script([])
    async def test_unknown_workload_is_404(self, client: httpx.AsyncClient) -> None:
        assert (await client.get("/api/k8s/workloads/tickup/nope/logs/stream")).status_code == 404


class TestStatus:
    @pytest.mark.script([])
    async def test_problems_from_every_source_worst_first(self, client: httpx.AsyncClient) -> None:
        body = (await client.get("/api/status")).json()
        kinds = {p["kind"] for p in body["problems"]}
        assert {"pod", "argo", "alert", "event"} <= kinds
        severities = [p["severity"] for p in body["problems"]]
        assert severities == sorted(severities, key=lambda s: s != "bad")
        assert body["counts"]["unhealthy_pods"] >= 1 and body["counts"]["alerts"] >= 1
        assert body["errors"] == {}

    @pytest.mark.script([])
    async def test_a_problem_pod_links_to_its_components_logs(self, client: httpx.AsyncClient) -> None:
        body = (await client.get("/api/status")).json()
        pod = next(p for p in body["problems"] if p["kind"] == "pod")
        assert pod["link"] == "#cluster/apps/tickup/logs/tickup-web"

    @pytest.mark.script([])
    async def test_events_about_a_problem_pod_are_not_repeated(self, client: httpx.AsyncClient) -> None:
        body = (await client.get("/api/status")).json()
        pods = {p["name"] for p in body["problems"] if p["kind"] == "pod"}
        assert not any(p["name"].removeprefix("Pod/") in pods for p in body["problems"] if p["kind"] == "event")

    @pytest.mark.script([])
    async def test_a_dead_upstream_costs_only_its_rows(self, client: httpx.AsyncClient, monkeypatch) -> None:
        from jarvis.tools.argocd.fake import FakeArgoCDClient

        async def down(self: Any) -> list[Any]:
            raise RuntimeError("argocd is down")

        monkeypatch.setattr(FakeArgoCDClient, "list_apps", down)
        body = (await client.get("/api/status")).json()
        assert "argocd.apps" in body["errors"]
        assert not any(p["kind"] == "argo" for p in body["problems"])
        assert any(p["kind"] == "pod" for p in body["problems"])

    @pytest.mark.script([])
    async def test_brief_for_each_kind(self, client: httpx.AsyncClient) -> None:
        body = (await client.get("/api/status")).json()
        for problem in body["problems"]:
            if not problem["investigable"]:
                continue
            response = await client.get(
                "/api/status/brief",
                params={"kind": problem["kind"], "namespace": problem["namespace"], "name": problem["name"]},
            )
            assert response.status_code == 200, problem
            assert response.json()["prompt"].startswith("Investigate")

    @pytest.mark.script([])
    async def test_brief_for_a_vanished_pod_is_404(self, client: httpx.AsyncClient) -> None:
        response = await client.get(
            "/api/status/brief", params={"kind": "pod", "namespace": "tickup", "name": "gone-123"}
        )
        assert response.status_code == 404

    @pytest.mark.script([])
    async def test_alert_brief_without_alertmanager_is_503(self, client: httpx.AsyncClient, monkeypatch) -> None:
        from jarvis.exceptions import ConfigurationError
        from jarvis.tools import alertmanager

        def unconfigured() -> None:
            raise ConfigurationError("alertmanager is not configured: set JARVIS_ALERTMANAGER_URL")

        monkeypatch.setattr(alertmanager.provider, "get", unconfigured)
        response = await client.get("/api/status/brief", params={"kind": "alert", "name": "59917779b926e5e6"})
        assert response.status_code == 503
        assert "JARVIS_ALERTMANAGER_URL" in response.json()["detail"]


class TestGateway:
    @pytest.mark.script([])
    async def test_keys_models_and_errors(self, client: httpx.AsyncClient) -> None:
        body = (await client.get("/api/gateway?hours=24")).json()
        assert body["window_hours"] == 24 and body["sources"] == {}
        keys = {k["alias"]: k for k in body["keys"]}
        assert keys["alfred"]["budget_used"] == pytest.approx(0.86)
        assert keys["jarvis"]["requests"] == 38 and keys["jarvis"]["failures"] == 7
        assert body["keys"][0]["alias"] == "alfred"  # closest to its budget first
        models = {m["model"]: m for m in body["models"]}
        assert models["claude-opus-5"]["p95_ms"] == 11_800
        assert models["local/qwen3-14b"]["failures"] == 6
        assert all("Traceback" not in e["message"] for e in body["errors"])
        assert len(body["daily"]) == 14

    @pytest.mark.script([])
    async def test_unconfigured_is_a_note_not_an_error(self, client: httpx.AsyncClient, monkeypatch) -> None:
        from jarvis import gateway
        from jarvis.exceptions import ConfigurationError

        def unconfigured() -> None:
            raise ConfigurationError("litellm is not configured: set JARVIS_LITELLM_DB_URL")

        monkeypatch.setattr(gateway.provider, "get", unconfigured)
        response = await client.get("/api/gateway")
        assert response.status_code == 200
        assert "JARVIS_LITELLM_DB_URL" in response.json()["sources"]["litellm"]
        status = (await client.get("/api/status")).json()
        assert "litellm" not in status["errors"]
        assert not any(p["id"].startswith("gateway:") for p in status["problems"])

    @pytest.mark.script([])
    async def test_a_broken_function_costs_one_panel(self, client: httpx.AsyncClient, monkeypatch) -> None:
        from jarvis.gateway.fake import FakeGatewayUsageClient

        async def broken(self: Any, since: Any, limit: int = 20) -> list[Any]:
            raise RuntimeError('column "metadata" does not exist')

        monkeypatch.setattr(FakeGatewayUsageClient, "recent_errors", broken)
        body = (await client.get("/api/gateway")).json()
        assert "litellm.recent_errors" in body["sources"]
        assert body["errors"] == [] and body["keys"]

    @pytest.mark.script([])
    async def test_status_flags_budget_and_failing_model(self, client: httpx.AsyncClient) -> None:
        problems = {p["id"]: p for p in (await client.get("/api/status")).json()["problems"]}
        budget = problems["gateway:budget:alfred"]
        assert budget["severity"] == "warn" and "86%" in budget["title"] and "$10" in budget["title"]
        assert "gateway:budget:jarvis" not in problems
        failing = problems["gateway:failures:local/qwen3-14b"]
        assert "6/7" in failing["title"]
        assert "gateway:failures:claude-opus-5" not in problems  # 1/31 is noise
