"""The tool registry.

Holds every ``ToolSpec`` in the process and answers the three questions the rest
of Jarvis asks: what tools exist, what does the model get told about them, and
what happens when the model calls one by name.

Capabilities are registered as whole modules. Adding a new one is a single line
in :mod:`jarvis.tools` — nothing here changes.
"""

from __future__ import annotations

from typing import Any, Iterable

from jarvis.core.types import RiskLevel, ToolCall, ToolResult
from jarvis.exceptions import ToolNotFoundError
from jarvis.logging import get_logger
from jarvis.tools.base import ToolSpec

logger = get_logger(__name__)


class ToolRegistry:
    """A name-addressed collection of tools.

    Example:
        >>> registry = ToolRegistry()
        >>> registry.register_many(github_tools)          # doctest: +SKIP
        >>> registry.names()                              # doctest: +SKIP
        ['github__open_pr', 'github__read_file', ...]
    """

    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    # --- population ---------------------------------------------------------

    def register(self, spec: ToolSpec) -> None:
        """Add one tool, replacing any tool of the same name."""
        if spec.name in self._tools:
            logger.warning("registry.replaced", tool=spec.name)
        self._tools[spec.name] = spec

    def register_many(self, specs: Iterable[ToolSpec]) -> None:
        """Add several tools."""
        for spec in specs:
            self.register(spec)

    # --- lookup -------------------------------------------------------------

    def get(self, name: str) -> ToolSpec:
        """Return a tool by name.

        Raises:
            ToolNotFoundError: If no such tool is registered.
        """
        try:
            return self._tools[name]
        except KeyError:
            raise ToolNotFoundError(f"no tool named {name!r}; have {', '.join(sorted(self._tools))}") from None

    def risk_of(self, name: str) -> RiskLevel:
        """Return a tool's risk level, defaulting to ``DESTRUCTIVE`` for unknowns.

        Failing closed matters here: an unrecognised name should stop the run, not
        sail through the gate.
        """
        spec = self._tools.get(name)
        return spec.risk if spec else RiskLevel.DESTRUCTIVE

    def names(self) -> list[str]:
        """Every registered tool name, sorted."""
        return sorted(self._tools)

    def all(self) -> list[ToolSpec]:
        """Every registered tool, sorted by name."""
        return [self._tools[name] for name in self.names()]

    def by_namespace(self) -> dict[str, list[ToolSpec]]:
        """Tools grouped by capability, for the dashboard."""
        grouped: dict[str, list[ToolSpec]] = {}
        for spec in self.all():
            grouped.setdefault(spec.namespace, []).append(spec)
        return grouped

    # --- use ----------------------------------------------------------------

    def to_anthropic(self) -> list[dict[str, Any]]:
        """Render every tool as an Anthropic tool definition.

        Sorted by name so the serialised list is byte-identical between requests —
        an unstable tool list silently invalidates the prompt cache prefix.
        """
        return [spec.to_anthropic() for spec in self.all()]

    async def invoke(self, call: ToolCall) -> ToolResult:
        """Execute a call, returning an error result rather than raising."""
        try:
            spec = self.get(call.name)
        except ToolNotFoundError as exc:
            return ToolResult(id=call.id, name=call.name, ok=False, content=f"Error: {exc}")
        return await spec.run(call.id, call.args)

    def __len__(self) -> int:
        return len(self._tools)

    def __contains__(self, name: object) -> bool:
        return name in self._tools

    def __repr__(self) -> str:
        return f"ToolRegistry({len(self._tools)} tools: {', '.join(sorted(self._tools))})"


__all__ = ["ToolRegistry"]
