"""Tool definition.

A capability produces ``ToolSpec`` objects and nothing else. The registry collects
them, the policy gate reads their ``risk``, the model node turns them into
Anthropic tool definitions, and the UI renders them — none of those layers knows
anything about GitHub, ArgoCD or Kubernetes.

The JSON Schema is derived from the function signature and the Google-style
docstring, so a tool is written once, as an ordinary typed async function:

    >>> @tool(namespace="k8s", risk=RiskLevel.READ)
    ... async def list_pods(namespace: str = "all") -> str:
    ...     '''List pods and their phase.
    ...
    ...     Args:
    ...         namespace: Namespace to list, or "all" for every namespace.
    ...     '''
    ...     return "..."
    >>> list_pods.name
    'k8s__list_pods'
    >>> list_pods.input_schema["properties"]["namespace"]["description"]
    'Namespace to list, or "all" for every namespace.'

The resulting object is callable, so tests can await it directly.
"""

from __future__ import annotations

import inspect
import re
import time
import types
import typing
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal, get_args, get_origin

from jarvis.core.types import RiskLevel, ToolResult
from jarvis.logging import get_logger

logger = get_logger(__name__)

_JSON_TYPES: dict[Any, str] = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    list: "array",
    dict: "object",
}

_ARGS_HEADER = re.compile(r"^\s*(Args|Arguments|Parameters)\s*:\s*$", re.MULTILINE)
_ARG_LINE = re.compile(r"^\s{4,}(\*{0,2}\w+)\s*(?:\([^)]*\))?\s*:\s*(.+)$")
_SECTION_HEADER = re.compile(r"^\s*(Returns|Raises|Yields|Example|Examples|Note|Notes|Warning)\s*:\s*$")


# ============================================================================
# Docstring parsing
# ============================================================================


def split_docstring(doc: str | None) -> tuple[str, dict[str, str]]:
    """Split a Google-style docstring into its summary and its ``Args`` entries.

    Args:
        doc: The raw ``__doc__``, or None.

    Returns:
        A ``(summary, {param: description})`` pair. The summary is everything
        before the first section header, whitespace-collapsed.
    """
    if not doc:
        return "", {}

    text = inspect.cleandoc(doc)
    match = _ARGS_HEADER.search(text)
    summary_raw = text[: match.start()] if match else text
    summary = " ".join(line.strip() for line in summary_raw.strip().splitlines() if line.strip())

    if not match:
        return summary, {}

    params: dict[str, str] = {}
    current: str | None = None
    for line in text[match.end() :].splitlines():
        if not line.strip():
            continue
        if _SECTION_HEADER.match(line):
            break
        entry = _ARG_LINE.match(line)
        if entry:
            current = entry.group(1).lstrip("*")
            params[current] = entry.group(2).strip()
        elif current:
            # Continuation of the previous parameter's description.
            params[current] = f"{params[current]} {line.strip()}"
    return summary, params


# ============================================================================
# Schema derivation
# ============================================================================


def _annotation_to_schema(annotation: Any) -> dict[str, Any]:
    """Map a type annotation onto a JSON Schema fragment.

    Handles ``X | None`` by unwrapping to ``X`` (optionality is expressed by
    leaving the parameter out of ``required``, not by a null type), and
    ``Literal[...]`` by emitting an enum.
    """
    if annotation is inspect.Parameter.empty or annotation is Any:
        return {"type": "string"}

    origin = get_origin(annotation)

    if origin is Literal:
        choices = list(get_args(annotation))
        kinds = {_JSON_TYPES.get(type(c), "string") for c in choices}
        return {"type": kinds.pop() if len(kinds) == 1 else "string", "enum": choices}

    if origin in (typing.Union, types.UnionType):
        inner = [a for a in get_args(annotation) if a is not type(None)]
        return _annotation_to_schema(inner[0]) if len(inner) == 1 else {"type": "string"}

    if origin in (list, set, tuple):
        args = get_args(annotation)
        return {"type": "array", "items": _annotation_to_schema(args[0]) if args else {"type": "string"}}

    if origin is dict:
        return {"type": "object"}

    if isinstance(annotation, type):
        if issubclass(annotation, bool):
            return {"type": "boolean"}
        for py_type, json_type in _JSON_TYPES.items():
            if issubclass(annotation, py_type):
                return {"type": json_type}

    return {"type": "string"}


def build_schema(fn: Callable[..., Any]) -> dict[str, Any]:
    """Derive an Anthropic ``input_schema`` from a function's signature and docstring."""
    signature = inspect.signature(fn)
    hints = typing.get_type_hints(fn)
    _, descriptions = split_docstring(fn.__doc__)

    properties: dict[str, Any] = {}
    required: list[str] = []

    for name, param in signature.parameters.items():
        if name in ("self", "cls") or param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
            continue
        schema = _annotation_to_schema(hints.get(name, param.annotation))
        if name in descriptions:
            schema["description"] = descriptions[name]
        if param.default is not inspect.Parameter.empty and param.default is not None:
            schema["default"] = param.default
        else:
            if param.default is inspect.Parameter.empty:
                required.append(name)
        properties[name] = schema

    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


# ============================================================================
# ToolSpec
# ============================================================================


@dataclass(frozen=True)
class ToolSpec:
    """One callable capability, fully described.

    Attributes:
        name: Fully qualified ``namespace__verb``. This is what the model sees,
            so the separator is ``__`` and not ``.``: the Anthropic API only
            accepts tool names matching ``^[a-zA-Z0-9_-]{1,128}$``.
        description: Summary line from the docstring, shown to the model.
        input_schema: JSON Schema for the arguments.
        risk: What the policy gate does with it.
        fn: The coroutine that does the work.
    """

    name: str
    description: str
    input_schema: dict[str, Any]
    risk: RiskLevel
    fn: Callable[..., Awaitable[str]]
    tags: tuple[str, ...] = field(default=())

    @property
    def namespace(self) -> str:
        """The capability this tool belongs to, e.g. ``github``."""
        return self.name.split("__", 1)[0]

    def __call__(self, **kwargs: Any) -> Awaitable[str]:
        """Invoke the underlying function directly, bypassing error handling."""
        return self.fn(**kwargs)

    async def run(self, call_id: str, args: dict[str, Any]) -> ToolResult:
        """Execute and always return a ``ToolResult`` — never raise.

        A tool that blows up must come back to the model as an error result it can
        reason about and recover from, not as an exception that kills the run.
        """
        started = time.monotonic()
        try:
            content = await self.fn(**args)
            ok = True
        except TypeError as exc:
            content = f"Error: invalid arguments for {self.name}: {exc}"
            ok = False
            logger.warning("tool.bad_args", tool=self.name, error=str(exc))
        except Exception as exc:  # noqa: BLE001 - deliberate: the model handles it
            content = f"Error: {type(exc).__name__}: {exc}"
            ok = False
            logger.warning("tool.failed", tool=self.name, error=str(exc), exc_info=True)

        return ToolResult(
            id=call_id,
            name=self.name,
            ok=ok,
            content=content if content else "(no output)",
            duration_ms=(time.monotonic() - started) * 1000,
        )

    def to_anthropic(self) -> dict[str, Any]:
        """Render as an Anthropic tool definition."""
        return {"name": self.name, "description": self.description, "input_schema": self.input_schema}


def tool(
    *,
    namespace: str,
    risk: RiskLevel,
    name: str | None = None,
    description: str | None = None,
    tags: tuple[str, ...] = (),
) -> Callable[[Callable[..., Awaitable[str]]], ToolSpec]:
    """Turn an async function into a ``ToolSpec``.

    Args:
        namespace: Capability name — becomes the prefix of the tool name.
        risk: How the policy gate should treat it. Be honest here; it is the
            only thing standing between the model and an irreversible action.
        name: Override the verb. Defaults to the function name.
        description: Override the description. Defaults to the docstring summary.
        tags: Free-form labels, used by the dashboard to group tools.
    """

    def decorator(fn: Callable[..., Awaitable[str]]) -> ToolSpec:
        if not inspect.iscoroutinefunction(fn):
            raise TypeError(f"{fn.__name__} must be an async function to be a tool")
        summary, _ = split_docstring(fn.__doc__)
        return ToolSpec(
            name=f"{namespace}__{name or fn.__name__}",
            description=description or summary or fn.__name__,
            input_schema=build_schema(fn),
            risk=risk,
            fn=fn,
            tags=tags,
        )

    return decorator


__all__ = ["ToolSpec", "build_schema", "split_docstring", "tool"]
