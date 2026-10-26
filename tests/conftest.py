"""Shared fixtures.

Fakes are written by hand as real classes satisfying the protocols, rather than
``unittest.mock`` objects — the Quaerium convention, and it keeps the tests
readable as specifications of what each seam is supposed to do.
"""

from __future__ import annotations

import os
from typing import Any

import pytest

os.environ.setdefault("JARVIS_FAKE_TOOLS", "true")

from jarvis.agent.llm import ScriptedLLM  # noqa: E402
from jarvis.core.policy import PolicyGate  # noqa: E402
from jarvis.core.types import RiskLevel  # noqa: E402
from jarvis.settings import get_settings  # noqa: E402
from jarvis.tools import build_registry, reset_capabilities  # noqa: E402
from jarvis.tools.base import tool  # noqa: E402
from jarvis.tools.registry import ToolRegistry  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_capabilities() -> Any:
    """Drop cached capability clients between tests."""
    reset_capabilities()
    get_settings.cache_clear()
    yield
    reset_capabilities()


@pytest.fixture
def registry() -> ToolRegistry:
    """The full registry, with every capability served from fixtures."""
    return build_registry()


@pytest.fixture
def toy_registry() -> ToolRegistry:
    """A three-tool registry, one per risk level."""

    @tool(namespace="toy", risk=RiskLevel.READ)
    async def peek(what: str = "nothing") -> str:
        """Look at something."""
        return f"saw {what}"

    @tool(namespace="toy", risk=RiskLevel.WRITE)
    async def draft(text: str) -> str:
        """Write a draft."""
        return f"drafted {text}"

    @tool(namespace="toy", risk=RiskLevel.DESTRUCTIVE)
    async def demolish(target: str) -> str:
        """Tear something down."""
        return f"demolished {target}"

    @tool(namespace="toy", risk=RiskLevel.READ)
    async def explode() -> str:
        """Always fails."""
        raise RuntimeError("boom")

    built = ToolRegistry()
    built.register_many([peek, draft, demolish, explode])
    return built


@pytest.fixture
def policy() -> PolicyGate:
    """The configured policy: read=auto, write=PR, destructive=confirm."""
    return PolicyGate()


@pytest.fixture
def scripted() -> Any:
    """Factory for a scripted model."""
    return ScriptedLLM
