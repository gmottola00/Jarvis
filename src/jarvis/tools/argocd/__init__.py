"""ArgoCD capability — the cluster's desired state, as reconciled from Git."""

from __future__ import annotations

from jarvis.tools.argocd.tools import TOOLS, provider

__all__ = ["TOOLS", "provider"]
