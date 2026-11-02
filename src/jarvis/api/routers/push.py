"""Push notifications: the phone subscribes through Jarvis, never to the hub directly.

The hub is cluster-internal; the browser only knows Jarvis's origin.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from jarvis.api.deps import Services, services
from jarvis.notify import NotifyError, NotifyUnavailable

router = APIRouter(prefix="/api/push", tags=["push"])


class SubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class SubscriptionIn(BaseModel):
    """``PushSubscription.toJSON()`` plus a label to tell devices apart."""

    endpoint: str
    keys: SubscriptionKeys
    label: str | None = Field(default=None, max_length=255)


class EndpointIn(BaseModel):
    endpoint: str


def _fail(exc: NotifyError) -> HTTPException:
    status = 503 if isinstance(exc, NotifyUnavailable) else 502
    return HTTPException(status_code=status, detail=str(exc))


@router.get("/key")
async def key(svc: Services = Depends(services)) -> dict[str, str]:
    """The VAPID public key for ``pushManager.subscribe``. 503 when notifications are off."""
    try:
        return {"key": await svc.notifier.public_key()}
    except NotifyError as exc:
        raise _fail(exc) from None


@router.put("/subscription", status_code=204)
async def subscribe(body: SubscriptionIn, svc: Services = Depends(services)) -> Response:
    """Register this device. Idempotent: the site calls it on every launch to stay in sync."""
    try:
        await svc.notifier.subscribe(body.model_dump(exclude_none=True))
    except NotifyError as exc:
        raise _fail(exc) from None
    return Response(status_code=204)


@router.delete("/subscription", status_code=204)
async def unsubscribe(body: EndpointIn, svc: Services = Depends(services)) -> Response:
    try:
        await svc.notifier.unsubscribe(body.endpoint)
    except NotifyError as exc:
        raise _fail(exc) from None
    return Response(status_code=204)


@router.post("/test")
async def test(svc: Services = Depends(services)) -> dict[str, Any]:
    """Send a test notification to every subscribed device."""
    if not svc.notifier.available:
        raise _fail(NotifyUnavailable("Notifications are not configured on this Jarvis."))
    delivery = await svc.notifier.notify(
        "Notifications on",
        "Jarvis will tell you here when a run needs your approval.",
        url="/#jarvis/approvals",
        tag="jarvis:test",
    )
    if delivery is None:
        raise HTTPException(status_code=502, detail="The notification service is not responding.")
    return {"sent": delivery.sent, "failed": delivery.failed, "removed": delivery.removed}
