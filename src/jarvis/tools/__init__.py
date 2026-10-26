"""The tool layer.

**This is where Jarvis grows.** Adding a capability is three steps:

1. Create ``src/jarvis/tools/<name>/`` with ``client.py`` (a typed async client),
   ``fake.py`` (the same surface, static fixtures) and ``tools.py`` (the ``@tool``
   functions plus a :class:`~jarvis.tools.provider.ClientProvider`).
2. Have its ``__init__.py`` export ``TOOLS`` and ``provider``.
3. Add it to :data:`CAPABILITIES` below.

Nothing else changes — not the graph, not the policy gate, not the API, not the
dashboard. The registry discovers the tools, the gate reads their risk, the model
node renders their schemas, and the UI groups them by namespace.

The rule that keeps this honest: a capability imports from ``jarvis.core``,
``jarvis.settings`` and ``jarvis.tools`` only. It never imports from
``jarvis.agent`` or ``jarvis.api``. That is what makes lifting one out into a
standalone MCP server an adapter rather than a rewrite.
"""

from __future__ import annotations

from types import ModuleType

from jarvis.tools import argocd, ghcr, github, k8s
from jarvis.tools.base import ToolSpec, tool
from jarvis.tools.provider import ClientProvider
from jarvis.tools.registry import ToolRegistry

CAPABILITIES: list[ModuleType] = [github, argocd, k8s, ghcr]
"""Every capability Jarvis can use. Append here to add one."""


def build_registry(*, capabilities: list[ModuleType] | None = None) -> ToolRegistry:
    """Assemble a registry from the capability modules.

    Args:
        capabilities: Override the module list, for tests that want a narrow set.

    Example:
        >>> registry = build_registry()
        >>> "github__open_pr" in registry
        True
    """
    registry = ToolRegistry()
    for module in capabilities if capabilities is not None else CAPABILITIES:
        registry.register_many(module.TOOLS)
    return registry


async def close_capabilities() -> None:
    """Close every capability's cached client. Called from the API lifespan."""
    for module in CAPABILITIES:
        await module.provider.aclose()


def reset_capabilities() -> None:
    """Drop every cached client, so the next call re-reads settings."""
    for module in CAPABILITIES:
        module.provider.reset()


__all__ = [
    "CAPABILITIES",
    "ClientProvider",
    "ToolRegistry",
    "ToolSpec",
    "build_registry",
    "close_capabilities",
    "reset_capabilities",
    "tool",
]
