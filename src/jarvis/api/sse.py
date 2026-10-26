"""Server-sent events.

One helper, so every streaming endpoint emits the same shape and the browser has
a single parser to write. Event names come from the ``type`` field of the
``RunEvent`` union, which is why that field is the discriminator.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

from sse_starlette.sse import EventSourceResponse

from jarvis.logging import get_logger

logger = get_logger(__name__)


async def _wrap(events: AsyncIterator[dict[str, Any]]) -> AsyncIterator[dict[str, str]]:
    """Adapt run events to sse-starlette's ``{event, data}`` form."""
    try:
        async for event in events:
            yield {"event": str(event.get("type", "message")), "data": json.dumps(event, default=str)}
    except Exception as exc:  # noqa: BLE001 - the client gets a reason, not a dropped socket
        logger.error("sse.stream_failed", error=str(exc), exc_info=True)
        yield {"event": "error", "data": json.dumps({"type": "error", "message": f"{type(exc).__name__}: {exc}"})}


def stream(events: AsyncIterator[dict[str, Any]]) -> EventSourceResponse:
    """Return an SSE response over a run event stream."""
    return EventSourceResponse(_wrap(events), ping=15)


__all__ = ["stream"]
