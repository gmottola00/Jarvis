"""GHCR tools — what is published, and what is safe to deploy."""

from __future__ import annotations

from typing import Any

from jarvis.core.types import RiskLevel
from jarvis.tools.base import ToolSpec, tool
from jarvis.tools.ghcr.client import GHCRClient
from jarvis.tools.ghcr.fake import FakeGHCRClient
from jarvis.tools.github import provider as github_provider
from jarvis.tools.provider import ClientProvider

provider: ClientProvider[Any] = ClientProvider(
    name="ghcr",
    real=lambda s: GHCRClient(s),
    fake=FakeGHCRClient,
    requires=lambda s: [] if s.github_token else ["JARVIS_GITHUB_TOKEN"],
)


def _repo_for(image: str) -> str:
    """Guess the source repository from an image name.

    Images are named ``<repo>-<component>`` by convention, so stripping the
    trailing component gives the repo that CI ran in.
    """
    for suffix in ("-backend", "-web", "-worker"):
        if image.endswith(suffix):
            return image[: -len(suffix)]
    return image


@tool(namespace="ghcr", risk=RiskLevel.READ)
async def list_tags(image: str, limit: int = 10) -> str:
    """List published tags for a container image, newest first.

    Args:
        image: Image name without the registry or owner, e.g. "tickup-web".
        limit: Maximum number of versions to inspect.
    """
    versions = await provider.get().list_versions(image, limit=limit)
    if not versions:
        return f"{image}: no published versions."
    lines = [f"ghcr.io/{provider.get().owner}/{image}: {len(versions)} version(s), newest first:"]
    for v in versions:
        lines.append(f"  {v['created_at'][:19]}  {', '.join(v['tags']) or '(untagged)'}")
    return "\n".join(lines)


@tool(namespace="ghcr", risk=RiskLevel.READ)
async def newest_green_tag(image: str, repo: str | None = None, limit: int = 10) -> str:
    """Find the newest published image tag whose CI checks all passed.

    This is the tag that is safe to deploy. Compare it against the newTag
    currently in the app's kustomization.yaml to decide whether there is
    anything to roll out.

    Args:
        image: Image name, e.g. "tickup-web".
        repo: Source repository for the CI checks. Defaults to the image name
            with its component suffix removed.
        limit: How many recent versions to consider.
    """
    source = repo or _repo_for(image)
    tags = await provider.get().sha_tags(image, limit=limit)
    if not tags:
        return f"{image}: no commit-SHA tags published; nothing deployable."

    github = github_provider.get()
    skipped: list[str] = []
    for sha, created in tags:
        if await github.commit_is_green(source, sha):
            note = f" (skipped {len(skipped)} newer, not green: {', '.join(s[:8] for s in skipped)})" if skipped else ""
            return f"{image}: newest green tag is {sha}, published {created[:19]} from {source}{note}"
        skipped.append(sha)

    return f"{image}: none of the {len(tags)} most recent tags is green. Newest is {tags[0][0]} ({tags[0][1][:19]})."


TOOLS: list[ToolSpec] = [list_tags, newest_green_tag]

__all__ = ["TOOLS", "provider"]
