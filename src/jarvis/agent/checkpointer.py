"""Checkpointer construction.

A run that stops to ask a question is only durable if its state was written
somewhere. With Postgres configured, a pending approval survives a backend
restart; without it, Jarvis still works and still interrupts, but a restart
forgets what it was waiting on.

The serializer is given an explicit allowlist rather than left permissive.
Checkpoint deserialization can construct arbitrary types, so naming exactly the
types Jarvis stores is both quieter and safer.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from jarvis.logging import get_logger
from jarvis.settings import Settings

logger = get_logger(__name__)

ALLOWED_TYPES: list[tuple[str, str]] = [
    ("jarvis.core.types", "RiskLevel"),
    ("jarvis.core.types", "Decision"),
    ("jarvis.core.types", "ToolCall"),
    ("jarvis.core.types", "ToolResult"),
    ("jarvis.core.types", "Approval"),
    ("jarvis.core.types", "Turn"),
    ("jarvis.core.types", "Usage"),
]
"""Every Jarvis type that can end up inside a checkpoint."""


def build_serde() -> Any:
    """Return a serializer that accepts Jarvis' own types and nothing else exotic."""
    from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

    return JsonPlusSerializer(allowed_msgpack_modules=ALLOWED_TYPES)


@asynccontextmanager
async def checkpointer(settings: Settings) -> AsyncIterator[Any]:
    """Yield a checkpointer, Postgres-backed when configured.

    Example:
        >>> async with checkpointer(settings) as saver:      # doctest: +SKIP
        ...     graph = build_graph(llm=llm, registry=registry, checkpointer=saver)
    """
    serde = build_serde()

    if not settings.database_url:
        from langgraph.checkpoint.memory import InMemorySaver

        logger.warning("checkpointer.in_memory", reason="JARVIS_DATABASE_URL is not set")
        yield InMemorySaver(serde=serde)
        return

    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    except ImportError:  # pragma: no cover - optional dependency
        from langgraph.checkpoint.memory import InMemorySaver

        logger.error("checkpointer.postgres_missing", hint="pip install 'jarvis[postgres]'")
        yield InMemorySaver(serde=serde)
        return

    async with AsyncPostgresSaver.from_conn_string(settings.database_url, serde=serde) as saver:
        await saver.setup()
        logger.info("checkpointer.postgres")
        yield saver


__all__ = ["ALLOWED_TYPES", "build_serde", "checkpointer"]
