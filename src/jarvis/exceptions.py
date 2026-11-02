"""Exception hierarchy.

One root, ``JarvisError``, so a caller can catch everything Jarvis raises without
catching everything Python raises. It sits below the agents kernel's root
(:class:`quaerium.agents.AgentError`), so catching that catches both.

The kernel's errors are re-exported here because capabilities and routers raise
and catch them by these names: a ``ConfigurationError`` from a
:class:`~quaerium.agents.ClientProvider` must be the same class the status router
catches, so these are the kernel's classes, not copies.

Nothing here is used for control flow inside the agent loop: a tool that fails
returns an error *result* to the model rather than raising, so the model can
recover. These exceptions are for wiring failures — bad config, unreachable
services, a tool that does not exist.
"""

from __future__ import annotations

from quaerium.agents.exceptions import (
    AgentError,
    ConfigurationError,
    ToolError,
    ToolNotFoundError,
    UpstreamError,
)


class JarvisError(AgentError):
    """Base for every error Jarvis raises."""


__all__ = [
    "AgentError",
    "ConfigurationError",
    "JarvisError",
    "ToolError",
    "ToolNotFoundError",
    "UpstreamError",
]
