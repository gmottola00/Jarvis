"""Exception hierarchy.

One root, ``JarvisError``, so a caller can catch everything Jarvis raises without
catching everything Python raises. Subsystems add their own leaves below it.

Nothing here is used for control flow inside the agent loop: a tool that fails
returns an error *result* to the model rather than raising, so the model can
recover. These exceptions are for wiring failures — bad config, unreachable
services, a tool that does not exist.
"""

from __future__ import annotations


class JarvisError(Exception):
    """Base for every error Jarvis raises."""


class ConfigurationError(JarvisError):
    """A required setting is missing or inconsistent."""


class ToolError(JarvisError):
    """Base for tool-layer failures."""


class ToolNotFoundError(ToolError):
    """The model asked for a tool that is not in the registry."""


class ToolExecutionError(ToolError):
    """A tool raised while executing."""


class UpstreamError(ToolError):
    """A capability's upstream service returned an error or was unreachable."""

    def __init__(self, service: str, message: str, *, status: int | None = None) -> None:
        self.service = service
        self.status = status
        super().__init__(f"{service}: {message}" + (f" (HTTP {status})" if status else ""))


class PolicyError(JarvisError):
    """An action was refused by the policy gate."""


class AgentError(JarvisError):
    """Base for orchestration failures."""


class MaxStepsExceededError(AgentError):
    """The graph hit its step ceiling without reaching an answer."""


__all__ = [
    "AgentError",
    "ConfigurationError",
    "JarvisError",
    "MaxStepsExceededError",
    "PolicyError",
    "ToolError",
    "ToolExecutionError",
    "ToolNotFoundError",
    "UpstreamError",
]
