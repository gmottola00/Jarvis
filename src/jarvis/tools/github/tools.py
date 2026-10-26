"""GitHub tools.

Risk assignment, which is the part worth reading carefully:

- Reads are ``READ``.
- ``create_branch``, ``commit_file`` and ``open_pr`` are ``WRITE``. They change a
  repository but not the cluster, and every one of them lands as a reviewable diff.
- ``merge_pr`` is ``DESTRUCTIVE``. Merging is what actually ships, and the design
  doc is explicit that this gate never gets automated.
"""

from __future__ import annotations

from typing import Any, Literal

from jarvis.core.types import RiskLevel
from jarvis.settings import get_settings
from jarvis.tools.base import ToolSpec, tool
from jarvis.tools.github.client import GitHubClient
from jarvis.tools.github.fake import FakeGitHubClient
from jarvis.tools.provider import ClientProvider

provider: ClientProvider[Any] = ClientProvider(
    name="github",
    real=lambda s: GitHubClient(s),
    fake=FakeGitHubClient,
    requires=lambda s: [] if s.github_token else ["JARVIS_GITHUB_TOKEN"],
)


def _default_repo(repo: str | None) -> str:
    """Resolve an omitted repo to the infra repo, which is the usual target."""
    return repo or get_settings().github_infra_repo


@tool(namespace="github", risk=RiskLevel.READ)
async def read_file(path: str, repo: str | None = None, ref: str | None = None) -> str:
    """Read a file from a repository.

    Args:
        path: Path within the repository, e.g. "apps/tickup/kustomization.yaml".
        repo: Repository name; defaults to the home lab infrastructure repo.
        ref: Branch, tag or commit SHA. Defaults to the default branch.
    """
    target = _default_repo(repo)
    content, _ = await provider.get().read_file(target, path, ref=ref)
    return f"{target}:{path}{f'@{ref}' if ref else ''}\n\n{content}"


@tool(namespace="github", risk=RiskLevel.READ)
async def list_prs(repo: str | None = None, state: Literal["open", "closed", "all"] = "open") -> str:
    """List pull requests in a repository.

    Args:
        repo: Repository name; defaults to the home lab infrastructure repo.
        state: Which pull requests to include.
    """
    target = _default_repo(repo)
    prs = await provider.get().list_prs(target, state=state)
    if not prs:
        return f"{target}: no {state} pull requests."
    lines = [f"{target}: {len(prs)} {state} pull request(s):"]
    for pr in prs:
        draft = " [draft]" if pr["draft"] else ""
        lines.append(f"  #{pr['number']}{draft} {pr['title']}  ({pr['head']} -> {pr['base']})\n    {pr['url']}")
    return "\n".join(lines)


@tool(namespace="github", risk=RiskLevel.READ)
async def check_runs(ref: str, repo: str | None = None) -> str:
    """Report CI status for a commit, branch or tag.

    Args:
        ref: Commit SHA, branch name or tag.
        repo: Repository name; defaults to the home lab infrastructure repo.
    """
    target = _default_repo(repo)
    runs = await provider.get().check_runs(target, ref)
    if not runs:
        return f"{target}@{ref[:12]}: no check runs reported."
    verdict = "GREEN" if all(r["conclusion"] in ("success", "neutral", "skipped") for r in runs) else "NOT GREEN"
    lines = [f"{target}@{ref[:12]}: {verdict}"]
    lines.extend(f"  {r['name']}: {r['status']}/{r['conclusion'] or 'pending'}" for r in runs)
    return "\n".join(lines)


@tool(namespace="github", risk=RiskLevel.WRITE)
async def create_branch(branch: str, repo: str | None = None, from_ref: str | None = None) -> str:
    """Create a branch. Nothing is deployed by this — it only prepares a place to commit.

    Args:
        branch: New branch name, e.g. "jarvis/bump-tickup-c92dfa1b".
        repo: Repository name; defaults to the home lab infrastructure repo.
        from_ref: Branch to fork from. Defaults to the default branch.
    """
    target = _default_repo(repo)
    sha = await provider.get().create_branch(target, branch, from_ref=from_ref)
    return f"Created {target}@{branch} from {from_ref or 'the default branch'} ({sha[:12]})."


@tool(namespace="github", risk=RiskLevel.WRITE)
async def commit_file(path: str, content: str, message: str, branch: str, repo: str | None = None) -> str:
    """Create or replace a file on a branch, as a single commit.

    The file content must be complete: this replaces the file, it does not patch
    it. Read the file first, edit the text, then write the whole thing back.

    Args:
        path: Path within the repository.
        content: The complete new file content.
        message: Commit message. Follow Conventional Commits, e.g. "chore(tickup): bump web to c92dfa1b".
        branch: Branch to commit on. Never commit directly to the default branch.
        repo: Repository name; defaults to the home lab infrastructure repo.
    """
    target = _default_repo(repo)
    sha = await provider.get().commit_file(target, path, content, message, branch)
    return f"Committed {path} to {target}@{branch} ({sha[:12]}): {message}"


@tool(namespace="github", risk=RiskLevel.WRITE)
async def open_pr(head: str, title: str, body: str, repo: str | None = None, base: str | None = None) -> str:
    """Open a pull request.

    Args:
        head: Branch containing the change.
        title: Pull request title.
        body: Description. Explain what changed and why, and name what will roll out.
        repo: Repository name; defaults to the home lab infrastructure repo.
        base: Target branch. Defaults to the default branch.
    """
    target = _default_repo(repo)
    pr = await provider.get().open_pr(target, head=head, title=title, body=body, base=base)
    return f"Opened {target}#{pr['number']} ({head} -> {pr['base']}): {pr['url']}"


@tool(namespace="github", risk=RiskLevel.DESTRUCTIVE)
async def merge_pr(
    number: int, repo: str | None = None, method: Literal["squash", "merge", "rebase"] = "squash"
) -> str:
    """Merge a pull request. This is what actually ships a change to the cluster.

    Args:
        number: Pull request number.
        repo: Repository name; defaults to the home lab infrastructure repo.
        method: Merge strategy.
    """
    target = _default_repo(repo)
    result = await provider.get().merge_pr(target, number, method=method)
    if not result["merged"]:
        return f"{target}#{number} was not merged: {result.get('message', 'unknown reason')}"
    return (
        f"Merged {target}#{number} ({result['sha'][:12]}). "
        "ArgoCD will reconcile on its next poll — check argocd__app_health next."
    )


TOOLS: list[ToolSpec] = [read_file, list_prs, check_runs, create_branch, commit_file, open_pr, merge_pr]

__all__ = ["TOOLS", "provider"]
