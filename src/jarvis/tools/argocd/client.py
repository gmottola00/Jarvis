"""ArgoCD REST client.

ArgoCD is the only thing that changes the cluster, so Jarvis reads it constantly
and writes to it almost never. The one non-read call here is a hard refresh,
which re-reads Git — it changes no desired state, but it is classified
destructive anyway because it can trigger a sync on an auto-sync application.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

import httpx
from quaerium.agents import get_logger

from jarvis.core.types import ArgoAppStatus
from jarvis.exceptions import UpstreamError
from jarvis.settings import Settings

logger = get_logger(__name__)


class ArgoCDClient:
    """Async client for the ArgoCD API server.

    Args:
        settings: Supplies ``argocd_base_url`` and ``argocd_token``. The base URL
            is the tailnet address of the ArgoCD ingress, e.g.
            ``https://argocd.<tailnet>.ts.net``.
    """

    def __init__(self, settings: Settings) -> None:
        if not settings.argocd_base_url or not settings.argocd_token:
            raise UpstreamError("argocd", "base URL and token are required")
        self._client = httpx.AsyncClient(
            base_url=settings.argocd_base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {settings.argocd_token.get_secret_value()}"},
            verify=settings.argocd_verify_tls,
            timeout=httpx.Timeout(20.0),
        )

    async def _get(self, path: str, **params: Any) -> dict[str, Any]:
        try:
            response = await self._client.get(path, params={k: v for k, v in params.items() if v is not None})
        except httpx.HTTPError as exc:
            raise UpstreamError("argocd", f"request to {path} failed: {exc}") from exc
        if response.status_code >= 400:
            raise UpstreamError("argocd", response.text[:300], status=response.status_code)
        payload: dict[str, Any] = response.json()
        return payload

    @staticmethod
    def _to_status(app: dict[str, Any]) -> ArgoAppStatus:
        status = app.get("status", {})
        spec = app.get("spec", {})
        source = spec.get("source", {})
        # Most apps here create their own Namespace and leave the destination empty;
        # the namespace most of their resources land in is then the answer.
        counts = Counter(r["namespace"] for r in status.get("resources") or [] if r.get("namespace"))
        namespace = spec.get("destination", {}).get("namespace") or (counts.most_common(1)[0][0] if counts else "")
        return ArgoAppStatus(
            name=app.get("metadata", {}).get("name", "?"),
            sync=status.get("sync", {}).get("status", "Unknown"),
            health=status.get("health", {}).get("status", "Unknown"),
            revision=(status.get("sync", {}).get("revision") or "")[:12],
            repo=source.get("repoURL", ""),
            path=source.get("path", ""),
            namespace=namespace,
        )

    async def list_apps(self) -> list[ArgoAppStatus]:
        """Return every registered Application with its sync and health status."""
        payload = await self._get("/api/v1/applications")
        return [self._to_status(app) for app in payload.get("items") or []]

    async def get_app(self, name: str, *, refresh: str | None = None) -> ArgoAppStatus:
        """Return one Application.

        Args:
            name: Application name.
            refresh: ``normal`` or ``hard`` to force a re-read of Git first.
        """
        payload = await self._get(f"/api/v1/applications/{name}", refresh=refresh)
        return self._to_status(payload)

    async def managed_resources(self, name: str) -> list[dict[str, Any]]:
        """Return the resources ArgoCD manages for an app, marking the drifted ones."""
        payload = await self._get(f"/api/v1/applications/{name}/managed-resources")
        return payload.get("items") or []

    async def aclose(self) -> None:
        await self._client.aclose()


__all__ = ["ArgoCDClient"]
