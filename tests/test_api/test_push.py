"""/api/push and the approval push, through the real app."""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator

import httpx
import pytest
from quaerium.agents import RiskLevel
from quaerium.agents.testing import ScriptedLLM

from jarvis.api.app import create_app
from jarvis.notify import Delivery, HubNotifier, Notifier, NullNotifier

from ..test_notify.test_client import FakeHub
from .test_endpoints import names, read_sse

SUB = {"endpoint": "https://web.push.apple.com/x", "keys": {"p256dh": "p", "auth": "a"}, "label": "iPhone"}


async def _client(notifier: Notifier, llm: Any = None) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(llm=llm or ScriptedLLM([]), notifier=notifier)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=30) as http:
            yield http


@pytest.fixture
def fake() -> FakeHub:
    return FakeHub()


@pytest.fixture
async def client(fake: FakeHub) -> AsyncIterator[httpx.AsyncClient]:
    async for http in _client(HubNotifier("http://hub", "tok", transport=httpx.MockTransport(fake))):
        yield http


@pytest.fixture
async def off() -> AsyncIterator[httpx.AsyncClient]:
    async for http in _client(NullNotifier()):
        yield http


async def test_capabilities_say_on(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/capabilities")).json()["notify"] is True


async def test_key(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/push/key")).json() == {"key": "BPUBLIC"}


async def test_subscribe_and_unsubscribe_reach_the_hub(client: httpx.AsyncClient, fake: FakeHub) -> None:
    assert (await client.put("/api/push/subscription", json=SUB)).status_code == 204
    r = await client.request("DELETE", "/api/push/subscription", json={"endpoint": SUB["endpoint"]})
    assert r.status_code == 204
    assert json.loads(fake.requests[0].content) == SUB


async def test_test_notification(client: httpx.AsyncClient, fake: FakeHub) -> None:
    assert (await client.post("/api/push/test")).json() == {"sent": 2, "failed": 0, "removed": 1}
    sent = json.loads(fake.requests[-1].content)
    assert sent["title"] == "Notifications on" and sent["url"] == "/#jarvis/approvals"


async def test_hub_down_is_502(fake: FakeHub, client: httpx.AsyncClient) -> None:
    fake.raise_ = httpx.ConnectError("refused")
    r = await client.get("/api/push/key")
    assert r.status_code == 502 and "not responding" in r.json()["detail"]
    assert (await client.post("/api/push/test")).status_code == 502


async def test_off_is_503(off: httpx.AsyncClient) -> None:
    assert (await off.get("/api/capabilities")).json()["notify"] is False
    assert (await off.get("/api/push/key")).status_code == 503
    assert (await off.put("/api/push/subscription", json=SUB)).status_code == 503
    assert (await off.post("/api/push/test")).status_code == 503


class RecordingNotifier(NullNotifier):
    """Notifications on, every notify recorded instead of sent."""

    available = True

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def notify(self, title: str, body: str | None = None, **kwargs: Any) -> Delivery | None:
        self.sent.append({"title": title, "body": body, **kwargs})
        return Delivery(sent=1, failed=0, removed=0)


async def test_a_suspended_run_pushes_once() -> None:
    notifier = RecordingNotifier()
    llm = ScriptedLLM(
        [
            ScriptedLLM.call("github__merge_pr", {"number": 12}, risk=RiskLevel.DESTRUCTIVE, text="Merging #12."),
            ScriptedLLM.say("Merged."),
        ]
    )
    async for http in _client(notifier, llm):
        session = (await http.post("/api/sessions")).json()["session_id"]
        events = await read_sse(http, "/api/chat", {"session_id": session, "message": "merge PR 12"})
        assert names(events)[-1] == "approval_required"
        run_id = events[-1][1]["run_id"]
        await asyncio.sleep(0)  # the push runs in the background

    (push,) = notifier.sent
    assert push["title"] == "Approval needed"
    assert push["body"].startswith("github__merge_pr")
    assert push["url"] == "/#jarvis/approvals"
    assert push["tag"] == f"approval:{run_id}"
    assert push["urgency"] == "high"


async def test_a_finished_run_does_not_push() -> None:
    notifier = RecordingNotifier()
    async for http in _client(notifier, ScriptedLLM([ScriptedLLM.say("Hi.")])):
        session = (await http.post("/api/sessions")).json()["session_id"]
        events = await read_sse(http, "/api/chat", {"session_id": session, "message": "hi"})
        assert names(events)[-1] == "done"
        await asyncio.sleep(0)
    assert notifier.sent == []
