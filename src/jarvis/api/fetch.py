"""Helpers shared by the console routers.

Every console endpoint asks several upstreams at once and must survive any one
of them being down: a dead upstream costs its own card, never the page.
"""

from __future__ import annotations

import asyncio
from typing import AsyncIterator, Awaitable, Callable, Mapping, TypeVar

from fastapi import HTTPException
from quaerium.agents import get_logger

logger = get_logger(__name__)

T = TypeVar("T")


async def attempt(name: str, call: Callable[[], Awaitable[T]], errors: dict[str, str]) -> T | None:
    """Run one fetch, recording a failure in ``errors[name]`` instead of raising it."""
    try:
        return await call()
    except Exception as exc:  # noqa: BLE001 - a dead upstream is a card, not a 500
        errors[name] = f"{type(exc).__name__}: {exc}"
        logger.warning("console.fetch_failed", target=name, error=str(exc))
        return None


def upstream_http_error(exc: Exception) -> HTTPException:
    """Turn an upstream failure into a status code the browser can act on: its own 4xx, else 502."""
    status = getattr(exc, "status", None)
    return HTTPException(status_code=status if isinstance(status, int) and status >= 400 else 502, detail=str(exc))


async def merge(
    streams: Mapping[str, AsyncIterator[T]], *, buffer: int = 1000
) -> AsyncIterator[tuple[str, T | BaseException]]:
    """Interleave several async streams as items arrive, each tagged with its key.

    Ends when every stream has ended. A stream that raises ends alone: its
    error is yielded as ``(key, exc)`` and the others carry on. Closing the
    merged iterator cancels every reader — the case that matters, because it
    is what happens when the browser goes away mid-stream.
    """
    queue: asyncio.Queue[tuple[str, T | BaseException] | None] = asyncio.Queue(maxsize=buffer)

    async def pump(key: str, source: AsyncIterator[T]) -> None:
        try:
            async for item in source:
                await queue.put((key, item))
        except asyncio.CancelledError:
            # The consumer is gone: nobody will read an end marker, and waiting
            # for room in a full queue would leave this task hanging forever.
            raise
        except Exception as exc:  # noqa: BLE001 - one dead stream should not end the others
            await queue.put((key, exc))
        await queue.put(None)

    tasks = [asyncio.create_task(pump(key, source)) for key, source in streams.items()]
    try:
        open_streams = len(tasks)
        while open_streams:
            entry = await queue.get()
            if entry is None:
                open_streams -= 1
            else:
                yield entry
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


__all__ = ["attempt", "merge", "upstream_http_error"]
