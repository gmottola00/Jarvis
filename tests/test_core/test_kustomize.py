"""The kustomization line editor: one change, nothing else touched."""

from __future__ import annotations

import pytest

from jarvis.core.kustomize import parse_images, parse_replicas, set_replicas
from jarvis.tools.github.fake import TICKUP_KUSTOMIZATION


class TestSetReplicas:
    def test_adds_a_block_and_keeps_everything_else(self) -> None:
        out = set_replicas(TICKUP_KUSTOMIZATION, "tickup-backend", 0)
        assert out.startswith(TICKUP_KUSTOMIZATION)
        assert out.endswith("replicas:\n  - name: tickup-backend\n    count: 0\n")
        assert parse_replicas(out) == {"tickup-backend": 0}
        assert parse_images(out) == parse_images(TICKUP_KUSTOMIZATION)

    def test_rewrites_only_the_count_line(self) -> None:
        once = set_replicas(TICKUP_KUSTOMIZATION, "tickup-backend", 0)
        twice = set_replicas(once, "tickup-backend", 1)
        changed = [(a, b) for a, b in zip(once.splitlines(), twice.splitlines()) if a != b]
        assert changed == [("    count: 0", "    count: 1")]

    def test_appends_a_second_deployment_inside_the_block(self) -> None:
        text = "replicas:\n  - name: a\n    count: 1\n\n# trailing comment\nimages: []\n"
        out = set_replicas(text, "b", 0)
        assert (
            out == "replicas:\n  - name: a\n    count: 1\n  - name: b\n    count: 0\n\n# trailing comment\nimages: []\n"
        )
        assert parse_replicas(out) == {"a": 1, "b": 0}

    def test_key_order_inside_an_entry_does_not_matter(self) -> None:
        text = "replicas:\n  - count: 3\n    name: a\n"
        assert set_replicas(text, "a", 0) == "replicas:\n  - count: 0\n    name: a\n"

    def test_entry_without_count_gets_one(self) -> None:
        assert parse_replicas(set_replicas("replicas:\n  - name: a\n", "a", 2)) == {"a": 2}

    def test_negative_is_refused(self) -> None:
        with pytest.raises(ValueError):
            set_replicas(TICKUP_KUSTOMIZATION, "tickup-backend", -1)
