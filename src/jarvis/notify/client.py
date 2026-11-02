"""Client for notify-hub, the lab's Web Push service.

Jarvis never talks to Apple directly: the hub holds the VAPID key and the
subscribed phones, Jarvis decides what to say. Two rules shape this client:

- **A notification never breaks the caller.** :meth:`HubNotifier.notify`
  catches everything, logs ``notify.failed`` and returns ``None``. A run that
  cannot reach the hub still waits for its approval.
- **Managing subscriptions is allowed to fail loudly**, because there a person
  is waiting for an answer: :class:`NotifyError` becomes a 502 with a message.

When ``JARVIS_NOTIFY_URL`` or ``NOTIFY_TOKEN`` is missing, :func:`build_notifier`
returns a :class:`NullNotifier`: notifications are off, and the site says so.

Example:
    >>> import asyncio
    >>> asyncio.run(NullNotifier().notify("Hello")) is None
    True
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol

import httpx
from quaerium.agents import get_logger

from jarvis.settings import Settings

logger = get_logger(__name__)

Urgency = Literal["very-low", "low", "normal", "high"]


class NotifyError(Exception):
    """The hub refused a request or could not be reached. The message is for the user."""


class NotifyUnavailable(NotifyError):
    """Notifications are not configured on this Jarvis."""


@dataclass(frozen=True)
class Delivery:
    """What the hub reports for one notify call."""

    sent: int
    failed: int
    removed: int


class Notifier(Protocol):
    available: bool

    async def public_key(self) -> str: ...
    async def subscribe(self, subscription: dict[str, Any]) -> None: ...
    async def unsubscribe(self, endpoint: str) -> None: ...
    async def notify(
        self,
        title: str,
        body: str | None = None,
        *,
        url: str | None = None,
        tag: str | None = None,
        urgency: Urgency = "normal",
    ) -> Delivery | None: ...
    async def aclose(self) -> None: ...


class NullNotifier:
    """Notifications off. Management calls raise, :meth:`notify` is a silent no-op."""

    available = False

    async def public_key(self) -> str:
        raise NotifyUnavailable("Notifications are not configured on this Jarvis.")

    async def subscribe(self, subscription: dict[str, Any]) -> None:
        raise NotifyUnavailable("Notifications are not configured on this Jarvis.")

    async def unsubscribe(self, endpoint: str) -> None:
        return None

    async def notify(
        self,
        title: str,
        body: str | None = None,
        *,
        url: str | None = None,
        tag: str | None = None,
        urgency: Urgency = "normal",
    ) -> Delivery | None:
        return None

    async def aclose(self) -> None:
        return None


class HubNotifier:
    """notify-hub over HTTP. One ``httpx.AsyncClient`` for the life of the process."""

    available = True

    def __init__(self, base_url: str, token: str, *, timeout: float = 5.0, transport: Any = None) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
            transport=transport,
        )
        self._key: str | None = None

    async def public_key(self) -> str:
        """The hub's VAPID public key. Cached: it changes only when the key is rotated, and then
        every subscription is void anyway."""
        if self._key is None:
            data = await self._request("GET", "/v1/vapid-public-key")
            self._key = str(data["key"])
        return self._key

    async def subscribe(self, subscription: dict[str, Any]) -> None:
        await self._request("PUT", "/v1/subscriptions", json=subscription)

    async def unsubscribe(self, endpoint: str) -> None:
        await self._request("DELETE", "/v1/subscriptions", json={"endpoint": endpoint})

    async def notify(
        self,
        title: str,
        body: str | None = None,
        *,
        url: str | None = None,
        tag: str | None = None,
        urgency: Urgency = "normal",
    ) -> Delivery | None:
        """Push to every phone subscribed to Jarvis. Never raises; ``None`` means it did not go out."""
        payload: dict[str, Any] = {"title": title, "urgency": urgency}
        for key, value in (("body", body), ("url", url), ("tag", tag)):
            if value is not None:
                payload[key] = value
        try:
            data = await self._request("POST", "/v1/notify", json=payload)
        except Exception as exc:  # noqa: BLE001 - a notification must never break the caller
            logger.warning("notify.failed", tag=tag, error=str(exc))
            return None
        delivery = Delivery(sent=int(data["sent"]), failed=int(data["failed"]), removed=int(data["removed"]))
        logger.info("notify.sent", tag=tag, sent=delivery.sent, failed=delivery.failed, removed=delivery.removed)
        return delivery

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = await self._http.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise NotifyError("The notification service is not responding.") from exc
        if response.status_code == 401:
            raise NotifyError("The notification service does not recognise Jarvis: check NOTIFY_TOKEN.")
        if response.status_code == 409:
            raise NotifyError("This device is registered with the notification service by another app.")
        if response.status_code == 422:
            raise NotifyError("The notification service rejected the request.")
        if response.is_error:
            raise NotifyError(f"The notification service answered {response.status_code}.")
        return response.json() if response.content else None


def build_notifier(settings: Settings) -> Notifier:
    """The hub client when configured, otherwise the no-op."""
    if settings.notify_url and settings.notify_token and settings.notify_token.get_secret_value():
        return HubNotifier(settings.notify_url, settings.notify_token.get_secret_value())
    return NullNotifier()


__all__ = [
    "Delivery",
    "HubNotifier",
    "Notifier",
    "NotifyError",
    "NotifyUnavailable",
    "NullNotifier",
    "build_notifier",
]
