"""Registry behaviour."""

from __future__ import annotations

import pytest

from jarvis.core.types import RiskLevel, ToolCall
from jarvis.exceptions import ToolNotFoundError


class TestRegistry:
    def test_holds_every_capability(self, registry) -> None:
        assert set(registry.by_namespace()) == {"github", "argocd", "k8s", "ghcr", "prometheus", "loki", "alertmanager"}
        assert len(registry) == 26

    def test_unknown_name_raises(self, registry) -> None:
        with pytest.raises(ToolNotFoundError):
            registry.get("nope.nope")

    def test_unknown_risk_fails_closed(self, registry) -> None:
        """An unrecognised tool must not sail through the gate as read-only."""
        assert registry.risk_of("nope.nope") is RiskLevel.DESTRUCTIVE

    def test_anthropic_definitions_are_stable(self, registry) -> None:
        """A reordered tool list silently invalidates the prompt cache prefix."""
        assert registry.to_anthropic() == registry.to_anthropic()
        assert [d["name"] for d in registry.to_anthropic()] == registry.names()

    def test_risk_assignments(self, registry) -> None:
        assert registry.risk_of("k8s__list_pods") is RiskLevel.READ
        assert registry.risk_of("github__open_pr") is RiskLevel.WRITE
        assert registry.risk_of("github__set_replicas") is RiskLevel.WRITE
        assert registry.risk_of("github__merge_pr") is RiskLevel.DESTRUCTIVE
        assert registry.risk_of("argocd__hard_refresh") is RiskLevel.DESTRUCTIVE

    def test_no_tool_mutates_the_cluster(self, registry) -> None:
        """The design rule, as an assertion: nothing here applies, patches or deletes."""
        forbidden = ("apply", "patch", "delete", "scale", "exec", "restart", "kubectl")
        offenders = [n for n in registry.names() if any(word in n.lower() for word in forbidden)]
        assert offenders == []

    async def test_invoke_unknown_returns_error_result(self, registry) -> None:
        result = await registry.invoke(ToolCall(id="x", name="nope.nope", args={}))
        assert not result.ok
        assert "no tool named" in result.content
