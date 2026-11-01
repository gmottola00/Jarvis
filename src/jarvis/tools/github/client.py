"""GitHub REST client.

This is the only capability that writes anything, and everything it writes is a
commit or a pull request. That is the whole safety argument of Jarvis: the agent
has no path to the cluster except through Git, so every action it takes shows up
as a diff someone can read and revert.
"""

from __future__ import annotations

import base64
from typing import Any

import httpx
from quaerium.agents import get_logger

from jarvis.exceptions import UpstreamError
from jarvis.settings import Settings

logger = get_logger(__name__)


class GitHubClient:
    """Async client for the GitHub REST API.

    Args:
        settings: Supplies ``github_token`` and the default ``github_owner``.
    """

    def __init__(self, settings: Settings) -> None:
        if not settings.github_token:
            raise UpstreamError("github", "a token is required")
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

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = await self._client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise UpstreamError("github", f"{method} {path} failed: {exc}") from exc
        if response.status_code >= 400:
            detail = response.json().get("message", response.text[:200]) if response.content else response.reason_phrase
            raise UpstreamError("github", f"{method} {path}: {detail}", status=response.status_code)
        return response.json() if response.content else {}

    def _repo_path(self, repo: str) -> str:
        """Accept either ``name`` or ``owner/name`` and return ``/repos/owner/name``."""
        return f"/repos/{repo}" if "/" in repo else f"/repos/{self.owner}/{repo}"

    # --- reads --------------------------------------------------------------

    async def default_branch(self, repo: str) -> str:
        payload = await self._request("GET", self._repo_path(repo))
        return str(payload.get("default_branch", "main"))

    async def read_file(self, repo: str, path: str, *, ref: str | None = None) -> tuple[str, str]:
        """Return a file's decoded text and its blob SHA."""
        payload = await self._request(
            "GET", f"{self._repo_path(repo)}/contents/{path}", params={"ref": ref} if ref else None
        )
        if isinstance(payload, list):
            raise UpstreamError("github", f"{path} is a directory, not a file")
        content = base64.b64decode(payload.get("content", "")).decode("utf-8", errors="replace")
        return content, str(payload.get("sha", ""))

    async def list_prs(self, repo: str, *, state: str = "open") -> list[dict[str, Any]]:
        payload = await self._request("GET", f"{self._repo_path(repo)}/pulls", params={"state": state, "per_page": 30})
        return [
            {
                "number": pr["number"],
                "title": pr["title"],
                "state": pr["state"],
                "head": pr["head"]["ref"],
                "base": pr["base"]["ref"],
                "draft": pr.get("draft", False),
                "url": pr["html_url"],
                "sha": pr["head"]["sha"],
            }
            for pr in payload
        ]

    async def check_runs(self, repo: str, ref: str) -> list[dict[str, Any]]:
        """Return CI check runs for a commit, branch or tag."""
        payload = await self._request("GET", f"{self._repo_path(repo)}/commits/{ref}/check-runs")
        return [
            {
                "name": run["name"],
                "status": run["status"],
                "conclusion": run.get("conclusion") or "",
                "url": run.get("html_url", ""),
            }
            for run in payload.get("check_runs", [])
        ]

    async def commit_is_green(self, repo: str, sha: str) -> bool:
        """Whether every completed check on a commit succeeded, and none is pending."""
        runs = await self.check_runs(repo, sha)
        if not runs:
            return False
        return all(r["status"] == "completed" and r["conclusion"] in ("success", "neutral", "skipped") for r in runs)

    # --- writes -------------------------------------------------------------

    async def create_branch(self, repo: str, branch: str, *, from_ref: str | None = None) -> str:
        """Create a branch off ``from_ref`` (default branch when omitted)."""
        base = from_ref or await self.default_branch(repo)
        ref = await self._request("GET", f"{self._repo_path(repo)}/git/ref/heads/{base}")
        sha = ref["object"]["sha"]
        await self._request(
            "POST", f"{self._repo_path(repo)}/git/refs", json={"ref": f"refs/heads/{branch}", "sha": sha}
        )
        return str(sha)

    async def commit_file(self, repo: str, path: str, content: str, message: str, branch: str) -> str:
        """Create or update a file on a branch. Returns the commit SHA."""
        body: dict[str, Any] = {
            "message": message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "branch": branch,
        }
        try:
            _, sha = await self.read_file(repo, path, ref=branch)
            body["sha"] = sha
        except UpstreamError as exc:
            if exc.status != 404:
                raise

        payload = await self._request("PUT", f"{self._repo_path(repo)}/contents/{path}", json=body)
        return str(payload.get("commit", {}).get("sha", ""))

    async def open_pr(self, repo: str, *, head: str, title: str, body: str, base: str | None = None) -> dict[str, Any]:
        target = base or await self.default_branch(repo)
        payload = await self._request(
            "POST",
            f"{self._repo_path(repo)}/pulls",
            json={"title": title, "body": body, "head": head, "base": target},
        )
        return {"number": payload["number"], "url": payload["html_url"], "base": target}

    async def merge_pr(self, repo: str, number: int, *, method: str = "squash") -> dict[str, Any]:
        payload = await self._request(
            "PUT", f"{self._repo_path(repo)}/pulls/{number}/merge", json={"merge_method": method}
        )
        return {
            "merged": payload.get("merged", False),
            "sha": payload.get("sha", ""),
            "message": payload.get("message", ""),
        }

    async def aclose(self) -> None:
        await self._client.aclose()


__all__ = ["GitHubClient"]
