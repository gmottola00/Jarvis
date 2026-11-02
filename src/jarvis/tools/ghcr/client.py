"""GHCR client, via the GitHub Packages API.

Reads container image versions from ``ghcr.io/<owner>/<image>``. It goes through
the Packages API rather than the registry's own ``/v2`` endpoints because that
returns publication timestamps, which is what makes "the newest green tag" a
question with an answer.

Requires a token with ``read:packages``.
"""

from __future__ import annotations

import re
from typing import Any

import httpx
from quaerium.agents import get_logger

from jarvis.exceptions import UpstreamError
from jarvis.settings import Settings

logger = get_logger(__name__)

SHA_TAG = re.compile(r"^[0-9a-f]{40}$")
"""CI tags images with the full commit SHA; that is the tag worth deploying."""


class GHCRClient:
    """Async client for container package versions."""

    def __init__(self, settings: Settings) -> None:
        if not settings.github_token:
            raise UpstreamError("ghcr", "a GitHub token with read:packages is required")
        self.owner = settings.github_owner
        self._client = httpx.AsyncClient(
            base_url=settings.github_api_url.rstrip("/"),
            headers={
                "Authorization": f"Bearer {settings.github_token.get_secret_value()}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=httpx.Timeout(30.0),
        )

    async def list_versions(self, image: str, *, limit: int = 30) -> list[dict[str, Any]]:
        """Return published versions of an image, newest first.

        Each entry is ``{"tags": [...], "created_at": ..., "digest": ...}``.
        """
        for scope in ("users", "orgs"):
            try:
                payload = await self._client.get(
                    f"/{scope}/{self.owner}/packages/container/{image}/versions",
                    params={"per_page": limit},
                )
            except httpx.HTTPError as exc:
                raise UpstreamError("ghcr", f"listing versions of {image} failed: {exc}") from exc
            if payload.status_code == 404:
                continue
            if payload.status_code >= 400:
                raise UpstreamError("ghcr", payload.text[:200], status=payload.status_code)

            versions = [
                {
                    "tags": v.get("metadata", {}).get("container", {}).get("tags", []),
                    "created_at": v.get("created_at", ""),
                    "digest": v.get("name", ""),
                }
                for v in payload.json()
            ]
            return sorted(versions, key=lambda v: v["created_at"], reverse=True)

        raise UpstreamError("ghcr", f"package {image!r} not found for owner {self.owner!r}", status=404)

    async def sha_tags(self, image: str, *, limit: int = 30) -> list[tuple[str, str]]:
        """Return ``(sha_tag, created_at)`` pairs, newest first."""
        pairs: list[tuple[str, str]] = []
        for version in await self.list_versions(image, limit=limit):
            for tag in version["tags"]:
                if SHA_TAG.match(tag):
                    pairs.append((tag, version["created_at"]))
        return pairs

    async def aclose(self) -> None:
        await self._client.aclose()


__all__ = ["GHCRClient", "SHA_TAG"]
