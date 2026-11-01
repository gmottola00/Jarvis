"""Offline stand-in for ArgoCD.

Mirrors ``bootstrap/apps/`` in Home-Lab-Infra: three Applications, each pointed at
``apps/<name>`` in the infra repo. ``tickup`` is left degraded to match the broken
pod in the Kubernetes fixtures, so a question like "why is tickup unhealthy?"
exercises two capabilities at once.
"""

from __future__ import annotations

from typing import Any

from jarvis.core.types import ArgoAppStatus

_REPO = "git@github.com:gmottola00/Home-Lab-Infra.git"

_APPS = {
    "trip-ai": ArgoAppStatus(
        name="trip-ai",
        sync="Synced",
        health="Healthy",
        revision="5156b7f3a1c2",
        repo=_REPO,
        path="apps/trip-ai",
        namespace="trip-ai",
    ),
    "tickup": ArgoAppStatus(
        name="tickup",
        sync="Synced",
        health="Degraded",
        revision="5156b7f3a1c2",
        repo=_REPO,
        path="apps/tickup",
        namespace="tickup",
    ),
    # No Tailscale ingress: only reachable inside the cluster.
    "postgres-base": ArgoAppStatus(
        name="postgres-base",
        sync="Synced",
        health="Healthy",
        revision="5156b7f3a1c2",
        repo=_REPO,
        path="apps/postgres-base",
        namespace="databases",
    ),
}


class FakeArgoCDClient:
    """Serves the fixtures above."""

    async def list_apps(self) -> list[ArgoAppStatus]:
        return list(_APPS.values())

    async def get_app(self, name: str, *, refresh: str | None = None) -> ArgoAppStatus:
        if name not in _APPS:
            from jarvis.exceptions import UpstreamError

            raise UpstreamError("argocd", f"application {name!r} not found", status=404)
        return _APPS[name]

    async def managed_resources(self, name: str) -> list[dict[str, Any]]:
        if name != "tickup":
            return []
        return [
            {
                "kind": "Deployment",
                "name": "tickup-web",
                "namespace": "tickup",
                "diff": "- image: ghcr.io/gmottola00/tickup-web:4f5e7497\n+ image: ghcr.io/gmottola00/tickup-web:c92dfa1b",
            }
        ]

    async def aclose(self) -> None:
        return None


__all__ = ["FakeArgoCDClient"]
