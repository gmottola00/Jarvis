"""Offline stand-in for GHCR.

Three published versions of each TickUp image. The newest one fails CI and the
one below it is green, so ``newest_green_tag`` has to actually do its job rather
than return the first row.
"""

from __future__ import annotations

from typing import Any

_VERSIONS: dict[str, list[dict[str, Any]]] = {
    "tickup-web": [
        {
            "tags": ["latest", "e17b4c9d02fa63581e7d4a0b9c25f83716ade4b0"],
            "created_at": "2026-08-25T17:55:00Z",
            "digest": "sha256:aa",
        },
        {
            "tags": ["c92dfa1b7e4a05936c81f2d7ab4e60c9518d3f7a"],
            "created_at": "2026-08-24T11:02:00Z",
            "digest": "sha256:bb",
        },
        {
            "tags": ["4f5e74971d3a8b6c05e2f9a71c4d8e30b6a91f27"],
            "created_at": "2026-08-14T09:31:00Z",
            "digest": "sha256:cc",
        },
    ],
    "tickup-backend": [
        {
            "tags": ["latest", "c92dfa1b7e4a05936c81f2d7ab4e60c9518d3f7a"],
            "created_at": "2026-08-24T11:02:00Z",
            "digest": "sha256:dd",
        },
        {
            "tags": ["c64b4218a7e91f3d5b8c02a4e6f7d9130ab5c2e8"],
            "created_at": "2026-08-14T09:31:00Z",
            "digest": "sha256:ee",
        },
    ],
    "trip-ai-web": [
        {
            "tags": ["latest", "438f84423e503baa36539934518e08d270dfb7cc"],
            "created_at": "2026-07-14T16:10:00Z",
            "digest": "sha256:ff",
        },
    ],
    "trip-ai-backend": [
        {
            "tags": ["latest", "ada2faf9b9ed076927b2c26c0a6d54a6826f3ecd"],
            "created_at": "2026-07-14T16:08:00Z",
            "digest": "sha256:00",
        },
    ],
}


class FakeGHCRClient:
    """Serves the fixtures above."""

    owner = "gmottola00"

    async def list_versions(self, image: str, *, limit: int = 30) -> list[dict[str, Any]]:
        if image not in _VERSIONS:
            from jarvis.exceptions import UpstreamError

            raise UpstreamError("ghcr", f"package {image!r} not found", status=404)
        return _VERSIONS[image][:limit]

    async def sha_tags(self, image: str, *, limit: int = 30) -> list[tuple[str, str]]:
        from jarvis.tools.ghcr.client import SHA_TAG

        return [
            (tag, v["created_at"])
            for v in await self.list_versions(image, limit=limit)
            for tag in v["tags"]
            if SHA_TAG.match(tag)
        ]

    async def aclose(self) -> None:
        return None


__all__ = ["FakeGHCRClient"]
