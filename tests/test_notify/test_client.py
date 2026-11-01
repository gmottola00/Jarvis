"""The notify-hub client, against a fake hub on httpx.MockTransport."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from jarvis.notify import HubNotifier, NotifyError, NotifyUnavailable, NullNotifier, build_notifier
from jarvis.settings import Settings


class FakeHub:
    """Records requests; answers like notify-hub, or with ``status`` when set."""

    def __init__(self, status: int | None = None, raise_: Exception | None = None) -> None:
        self.status = status
        self.raise_ = raise_
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.raise_ is not None:
            raise self.raise_
        if self.status is not None:
            return httpx.Response(self.status, json={"detail": "nope"})
        path = request.url.path
        if path == "/v1/vapid-public-key":
            return httpx.Response(200, json={"key": "BPUBLIC"})
        if path == "/v1/notify":
            return httpx.Response(200, json={"sent": 2, "failed": 0, "removed": 1})
        if path == "/v1/subscriptions" and request.method == "DELETE":
            return httpx.Response(204)
        return httpx.Response(200, json={"id": 1})


def hub(fake: FakeHub) -> HubNotifier:
    return HubNotifier("http://hub:8000/", "tok", transport=httpx.MockTransport(fake))


def body(request: httpx.Request) -> Any:
    return json.loads(request.content)


async def test_notify_sends_bearer_and_payload() -> None:
    fake = FakeHub()
    delivery = await hub(fake).notify("Approval needed", "github__merge_pr", url="/#jarvis/approvals", tag="approval:x")
    assert delivery is not None and (delivery.sent, delivery.removed) == (2, 1)
    (request,) = fake.requests
    assert request.url == "http://hub:8000/v1/notify"
    assert request.headers["authorization"] == "Bearer tok"
    assert body(request) == {
        "title": "Approval needed",
        "body": "github__merge_pr",
        "url": "/#jarvis/approvals",
        "tag": "approval:x",
        "urgency": "normal",
    }


@pytest.mark.parametrize(
    "fake", [FakeHub(status=500), FakeHub(status=401), FakeHub(raise_=httpx.ConnectError("refused"))]
)
async def test_notify_never_raises(fake: FakeHub) -> None:
    assert await hub(fake).notify("x") is None


async def test_public_key_is_cached() -> None:
    fake = FakeHub()
    client = hub(fake)
    assert await client.public_key() == "BPUBLIC"
    assert await client.public_key() == "BPUBLIC"
    assert len(fake.requests) == 1


async def test_subscription_calls() -> None:
    fake = FakeHub()
    client = hub(fake)
    sub = {"endpoint": "https://web.push.apple.com/x", "keys": {"p256dh": "p", "auth": "a"}}
    await client.subscribe(sub)
    await client.unsubscribe("https://web.push.apple.com/x")
    assert [(r.method, r.url.path) for r in fake.requests] == [
        ("PUT", "/v1/subscriptions"),
        ("DELETE", "/v1/subscriptions"),
    ]
    assert body(fake.requests[0]) == sub
    assert body(fake.requests[1]) == {"endpoint": "https://web.push.apple.com/x"}


async def test_management_errors_are_explained() -> None:
    with pytest.raises(NotifyError, match="NOTIFY_TOKEN"):
        await hub(FakeHub(status=401)).public_key()
    with pytest.raises(NotifyError, match="not responding"):
        await hub(FakeHub(raise_=httpx.ConnectError("refused"))).subscribe({})


async def test_null_notifier() -> None:
    null = NullNotifier()
    assert await null.notify("x") is None
    await null.unsubscribe("x")
    with pytest.raises(NotifyUnavailable):
        await null.public_key()


def test_build_notifier() -> None:
    assert isinstance(build_notifier(Settings(notify_url=None, notify_token=None)), NullNotifier)
    assert isinstance(build_notifier(Settings(notify_url="http://hub", notify_token="")), NullNotifier)
    assert isinstance(build_notifier(Settings(notify_url="http://hub", notify_token="t")), HubNotifier)
