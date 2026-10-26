"""Structured logging.

``structlog`` with a ``run_id`` bound as a context variable, so every line emitted
while a run is in flight carries it without being passed down through call
signatures. That is what makes the audit trail and the logs line up.

Example:
    >>> from jarvis.logging import configure_logging, bind_run, get_logger
    >>> configure_logging(level="INFO")
    >>> bind_run("run_abc123")
    >>> get_logger(__name__).info("tool.call", tool="k8s__list_pods")
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

_configured = False


def configure_logging(*, level: str = "INFO", json_output: bool = False) -> None:
    """Configure structlog and the stdlib root logger.

    Idempotent: calling it twice is a no-op, so importing it from both the API
    lifespan and a test fixture is safe.

    Args:
        level: Standard logging level name.
        json_output: Emit JSON lines instead of the human-readable console renderer.
    """
    global _configured
    if _configured:
        return

    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=getattr(logging, level.upper(), logging.INFO))

    processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.TimeStamper(fmt="iso"),
    ]
    processors.append(
        structlog.processors.JSONRenderer() if json_output else structlog.dev.ConsoleRenderer(colors=not json_output)
    )

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level.upper(), logging.INFO)),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    _configured = True


def bind_run(run_id: str, **extra: Any) -> None:
    """Bind a run id (and anything else) to the current async context."""
    structlog.contextvars.bind_contextvars(run_id=run_id, **extra)


def clear_run() -> None:
    """Clear the current context, at the end of a run."""
    structlog.contextvars.clear_contextvars()


def get_logger(name: str) -> Any:
    """Return a bound logger for a module."""
    return structlog.get_logger(name)


__all__ = ["bind_run", "clear_run", "configure_logging", "get_logger"]
