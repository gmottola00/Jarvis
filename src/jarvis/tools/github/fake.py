"""Offline stand-in for GitHub.

The repository fixtures reproduce the shape of ``Home-Lab-Infra`` closely enough
that the deploy flow can be rehearsed end to end without a token: a real
``apps/tickup/kustomization.yaml`` with an image tag to bump, a green commit, and
a mutable branch/PR store so a run can create a branch, commit to it, open a PR
and merge it.
"""

from __future__ import annotations

from typing import Any

from jarvis.exceptions import UpstreamError

TICKUP_KUSTOMIZATION = """apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
  - backend.yaml
  - web.yaml
  - ingress.yaml
  # Encrypted with kubeseal - safe to commit; only the in-cluster controller
  # can decrypt them.
  - sealed-secret.yaml
  - ghcr-pull-secret.yaml
# CI (TickUp repo workflows) bumps newTag to the commit SHA on every push to
# main; ArgoCD picks up the commit and rolls out. Do not edit newTag by hand.
images:
  - name: ghcr.io/gmottola00/tickup-backend
    newTag: c64b4218a7e91f3d5b8c02a4e6f7d9130ab5c2e8
  - name: ghcr.io/gmottola00/tickup-web
    newTag: 4f5e74971d3a8b6c05e2f9a71c4d8e30b6a91f27
"""

TRIP_AI_KUSTOMIZATION = """apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
  - backend.yaml
  - web.yaml
  - ingress.yaml
  - sealed-secret.yaml
  - ghcr-pull-secret.yaml
images:
  - name: ghcr.io/gmottola00/trip-ai-backend
    newTag: ada2faf9b9ed076927b2c26c0a6d54a6826f3ecd
  - name: ghcr.io/gmottola00/trip-ai-web
    newTag: 438f84423e503baa36539934518e08d270dfb7cc
"""
"""The app that is fully up to date — the delivery table needs a green row to
read against the amber ones."""

_FILES: dict[tuple[str, str], str] = {
    ("Home-Lab-Infra", "apps/tickup/kustomization.yaml"): TICKUP_KUSTOMIZATION,
    ("Home-Lab-Infra", "apps/trip-ai/kustomization.yaml"): TRIP_AI_KUSTOMIZATION,
    ("Home-Lab-Infra", "bootstrap/apps/tickup.yaml"): (
        "apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: tickup\n"
        "  namespace: argocd\nspec:\n  project: default\n  source:\n"
        "    repoURL: git@github.com:gmottola00/Home-Lab-Infra.git\n"
        "    targetRevision: main\n    path: apps/tickup\n"
    ),
}

_CHECKS = {
    "c92dfa1b7e4a05936c81f2d7ab4e60c9518d3f7a": [
        {"name": "build-backend", "status": "completed", "conclusion": "success", "url": ""},
        {"name": "build-web", "status": "completed", "conclusion": "success", "url": ""},
        {"name": "tests", "status": "completed", "conclusion": "success", "url": ""},
    ],
    "e17b4c9d02fa63581e7d4a0b9c25f83716ade4b0": [
        {"name": "build-backend", "status": "completed", "conclusion": "success", "url": ""},
        {"name": "tests", "status": "completed", "conclusion": "failure", "url": ""},
    ],
}


class FakeGitHubClient:
    """An in-memory GitHub. Mutations persist for the lifetime of the process."""

    owner = "gmottola00"

    def __init__(self) -> None:
        self._files = dict(_FILES)
        self._branches: dict[str, dict[str, str]] = {}
        self._prs: list[dict[str, Any]] = [
            {
                "number": 12,
                "title": "chore(tickup): bump web to c92dfa1b",
                "state": "open",
                "head": "jarvis/bump-tickup-c92dfa1b",
                "base": "main",
                "draft": False,
                "url": "https://github.com/gmottola00/Home-Lab-Infra/pull/12",
                "sha": "9f8e7d6c5b4a",
                "_repo": "Home-Lab-Infra",
            }
        ]
        self._next_pr = 13

    @staticmethod
    def _name(repo: str) -> str:
        return repo.split("/")[-1]

    async def default_branch(self, repo: str) -> str:
        return "main"

    async def read_file(self, repo: str, path: str, *, ref: str | None = None) -> tuple[str, str]:
        key = (self._name(repo), path)
        if ref and ref in self._branches and path in self._branches[ref]:
            return self._branches[ref][path], "branchsha"
        if key not in self._files:
            raise UpstreamError("github", f"Not Found: {path}", status=404)
        return self._files[key], "a1b2c3d4"

    async def list_prs(self, repo: str, *, state: str = "open") -> list[dict[str, Any]]:
        return [pr for pr in self._prs if state == "all" or pr["state"] == state]

    async def check_runs(self, repo: str, ref: str) -> list[dict[str, Any]]:
        return list(_CHECKS.get(ref, []))

    async def commit_is_green(self, repo: str, sha: str) -> bool:
        runs = _CHECKS.get(sha, [])
        return bool(runs) and all(r["conclusion"] == "success" for r in runs)

    async def create_branch(self, repo: str, branch: str, *, from_ref: str | None = None) -> str:
        self._branches[branch] = {}
        return "5156b7f3a1c2d4e6f8091a2b3c4d5e6f70819a2b"

    async def commit_file(self, repo: str, path: str, content: str, message: str, branch: str) -> str:
        self._branches.setdefault(branch, {})[path] = content
        return "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c"

    async def open_pr(self, repo: str, *, head: str, title: str, body: str, base: str | None = None) -> dict[str, Any]:
        number = self._next_pr
        self._next_pr += 1
        pr = {
            "number": number,
            "title": title,
            "state": "open",
            "head": head,
            "base": base or "main",
            "draft": False,
            "url": f"https://github.com/{self.owner}/{self._name(repo)}/pull/{number}",
            "sha": "9f8e7d6c5b4a",
            "_repo": self._name(repo),
        }
        self._prs.append(pr)
        return {"number": number, "url": pr["url"], "base": pr["base"]}

    async def merge_pr(self, repo: str, number: int, *, method: str = "squash") -> dict[str, Any]:
        for pr in self._prs:
            if pr["number"] == number:
                pr["state"] = "closed"
                # A merge lands the branch's files on main.
                for path, content in self._branches.get(pr["head"], {}).items():
                    self._files[(self._name(repo), path)] = content
                return {"merged": True, "sha": "0a1b2c3d4e5f", "message": "Pull Request successfully merged"}
        raise UpstreamError("github", f"pull request #{number} not found", status=404)

    async def aclose(self) -> None:
        return None


__all__ = ["FakeGitHubClient", "TICKUP_KUSTOMIZATION"]
