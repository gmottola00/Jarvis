"""Shared fixtures.

Fakes are written by hand as real classes satisfying the protocols, rather than
``unittest.mock`` objects — the Quaerium convention, and it keeps the tests
readable as specifications of what each seam is supposed to do.

The agent loop itself (graph, gate, runner, tool schemas) is Quaerium's and is
tested there; these tests cover what is Jarvis's: the capabilities, the routing
vocabulary, the policy texts, the model catalog and the application wired together.
"""

from __future__ import annotations

import os
from typing import Any

import pytest

os.environ.setdefault("JARVIS_FAKE_TOOLS", "true")
# No gateway and no GPU probe unless a test builds its own Settings: a developer's
# .env pointing at a live LiteLLM must not turn the suite into network calls.
os.environ.setdefault("JARVIS_LLM_GATEWAY_URL", "")
os.environ.setdefault("JARVIS_OLLAMA_URL", "")
# Same for notify-hub: no test may push to a real phone.
os.environ["JARVIS_NOTIFY_URL"] = ""

from quaerium.agents import PolicyGate, ToolRegistry  # noqa: E402
from quaerium.agents.testing import ScriptedLLM  # noqa: E402

from jarvis import gateway  # noqa: E402
from jarvis.agent.policy import build_policy  # noqa: E402
from jarvis.settings import get_settings  # noqa: E402
from jarvis.tools import build_registry, reset_capabilities  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_capabilities() -> Any:
    """Drop cached capability clients between tests."""
    reset_capabilities()
    gateway.provider.reset()
    get_settings.cache_clear()
    yield
    reset_capabilities()
    gateway.provider.reset()


@pytest.fixture
def registry() -> ToolRegistry:
    """The full registry, with every capability served from fixtures."""
    return build_registry()


@pytest.fixture
def policy() -> PolicyGate:
    """The configured policy: read=auto, write=PR, destructive=confirm."""
    return build_policy()


@pytest.fixture
def scripted() -> Any:
    """Factory for a scripted model."""
    return ScriptedLLM
