"""Delivery: the path from a commit to a running container, on one page.

Four systems have to agree for a deploy to be finished, and each of them knows
only its own part:

- **GHCR** knows what has been built.
- **GitHub Actions** knows which of those builds is green.
- **Git** — ``apps/<app>/kustomization.yaml`` — knows which tag is *pinned*.
- **the cluster** knows which tag is actually *running*.

Nobody shows you all four at once, so the usual way to answer "is tickup up to
date?" is four browser tabs and some squinting. This endpoint fetches them
concurrently and lines them up per image, and the answer becomes a column.

No model is involved. The agent can run this flow conversationally and open the
pull request at the end; the console just tells you, continuously and for free,
whether it needs to.
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Literal, TypeVar

from fastapi import APIRouter, Depends, Query

from jarvis.api.deps import Services, services
from jarvis.core.console import AppDelivery, ComponentDelivery, DeliveryOverview, PullRequestView
from jarvis.core.kustomize import parse_images
from jarvis.exceptions import UpstreamError
from jarvis.logging import get_logger
from jarvis.tools import argocd, ghcr, github, k8s

logger = get_logger(__name__)
router = APIRouter(prefix="/api/delivery", tags=["delivery"])

T = TypeVar("T")

_GREEN_DEPTH = 6
"""How many recent tags to ask GitHub about before giving up on finding a green one."""


async def _attempt(name: str, call: Callable[[], Awaitable[T]], errors: dict[str, str]) -> T | None:
    try:
        return await call()
    except Exception as exc:  # noqa: BLE001 - a dead upstream is a cell, not a 500
        errors[name] = f"{type(exc).__name__}: {exc}"
        logger.warning("delivery.fetch_failed", target=name, error=str(exc))
        return None


def _tag_of(image: str) -> str:
    """The tag part of ``registry/owner/name:tag``, empty when the image has none."""
    _, separator, tag = image.rpartition(":")
    return tag if separator and "/" not in tag else ""


def _repo_for(image: str) -> str:
    """The source repository for an image, by the lab's naming convention."""
    for suffix in ("-backend", "-web", "-worker"):
        if image.endswith(suffix):
            return image[: -len(suffix)]
    return image


async def _newest_tags(image: str, errors: dict[str, str]) -> tuple[str, str, str, list[str]]:
    """Return ``(newest, newest_green, published_at, recent)`` for one image."""
    # Clients are resolved inside the attempt: missing credentials are a
    # ConfigurationError, and that should cost a cell, not the whole page.
    tags = await _attempt(f"ghcr.{image}", lambda: ghcr.provider.get().sha_tags(image, limit=20), errors)
    if not tags:
        return "", "", "", []

    newest, published = tags[0]
    source = _repo_for(image)

    green = ""
    for sha, _ in tags[:_GREEN_DEPTH]:
        try:
            if await github.provider.get().commit_is_green(source, sha):
                green = sha
                break
        except Exception as exc:  # noqa: BLE001 - no checks is not an outage
            errors[f"checks.{source}"] = f"{type(exc).__name__}: {exc}"
            break

    return newest, green, published, [sha for sha, _ in tags]


def _classify(*, git_tag: str, running_tag: str, behind_by: int, workload_complete: bool) -> tuple[str, str]:
    """Decide what one component's three tags mean together."""
    if not git_tag and not running_tag:
        return "unknown", "Neither Git nor the cluster reports a tag for this image."
    if not running_tag:
        return "unknown", "Pinned in Git but no workload is running this image yet."
    if not git_tag:
        return "drifted", "Running in the cluster but not pinned in any kustomization."

    if git_tag != running_tag:
        if workload_complete:
            return (
                "drifted",
                "The cluster finished rolling out a tag that Git does not pin. "
                "Either someone changed it by hand, or ArgoCD has not synced.",
            )
        return "rolling-out", "Git moved and the cluster is still catching up."

    if behind_by > 0:
        return "behind", f"Up to date with Git, but {behind_by} newer tag(s) have been published."

    return "in-sync", "Git, the cluster and the registry all agree."


Tracking = Literal["kustomize", "helm", "manifests"]


async def _read_pins(app: str, path: str, errors: dict[str, str], svc: Services) -> tuple[Tracking, str, Any]:
    """Find out how an app pins its images, and read the pins if it does.

    Only one shape of Application has a tag this page can compare: a Git path
    with a ``kustomization.yaml`` listing ``images:``. The other two are normal
    and not failures — they just have nothing to put in the table:

    - **helm** — no ``path``: the app pulls a chart (``spec.sources`` /
      ``spec.source.chart``) and versions it with ``targetRevision``.
    - **manifests** — a path without a kustomization: ArgoCD applies the
      directory as plain YAML. ``root``, the app-of-apps, is one of these.

    Returns ``(tracking, note, file_result)``; ``file_result`` is ``None`` when
    the file could not be read, and the reason is in ``errors``.
    """
    if not path:
        return "helm", "A Helm chart (spec.sources): versioned by chart targetRevision, not by an image pin.", None

    kustomization = f"{path}/kustomization.yaml"
    try:
        return "kustomize", "", await github.provider.get().read_file(svc.settings.github_infra_repo, kustomization)
    except UpstreamError as exc:
        if exc.status == 404:
            return "manifests", f"No kustomization.yaml in {path}: ArgoCD applies it as plain manifests.", None
        errors[f"git.{app}"] = f"{type(exc).__name__}: {exc}"
    except Exception as exc:  # noqa: BLE001 - missing credentials cost a cell, not the page
        errors[f"git.{app}"] = f"{type(exc).__name__}: {exc}"
    return "kustomize", "", None


async def _components(app: str, path: str, file_result: Any, errors: dict[str, str]) -> list[ComponentDelivery]:
    """Build one app's rows: Git pin, running tag, registry state."""
    kustomization = f"{path}/kustomization.yaml"
    git_known = file_result is not None
    pins = parse_images(file_result[0]) if file_result else []

    workloads = await _attempt(f"k8s.{app}", lambda: k8s.provider.get().workloads(app), errors) or []
    running: dict[str, tuple[str, bool]] = {}
    for workload in workloads:
        for image in workload.images:
            name, _, _ = image.rpartition(":")
            running[name or image] = (_tag_of(image), workload.complete)

    rows: list[ComponentDelivery] = []
    for pin in pins:
        running_tag, complete = running.pop(pin.name, ("", False))
        newest, green, published, recent = await _newest_tags(pin.short, errors)

        behind_by = recent.index(pin.new_tag) if pin.new_tag in recent else (len(recent) if newest else 0)
        status, note = _classify(
            git_tag=pin.new_tag, running_tag=running_tag, behind_by=behind_by, workload_complete=complete
        )

        rows.append(
            ComponentDelivery(
                app=app,
                component=pin.short,
                image=pin.name,
                git_tag=pin.new_tag,
                running_tag=running_tag,
                newest_tag=newest,
                newest_green_tag=green,
                newest_at=published,
                behind_by=behind_by,
                status=status,  # type: ignore[arg-type]
                note=note,
            )
        )

    # Anything running that Git never pinned is exactly what a drift table is
    # for — but only if Git was actually read. An unreadable kustomization says
    # nothing about drift, so those rows are "unknown", not "drifted".
    for image, (tag, _) in running.items():
        rows.append(
            ComponentDelivery(
                app=app,
                component=image.rsplit("/", 1)[-1],
                image=image,
                running_tag=tag,
                status="drifted" if git_known else "unknown",
                note=(
                    "Running in the cluster with no pin in this app's kustomization."
                    if git_known
                    else f"Running in the cluster; the Git pin could not be read ({kustomization})."
                ),
            )
        )

    return rows


@router.get("/overview", response_model=DeliveryOverview)
async def overview(
    include_prs: bool = Query(True, description="Also list open pull requests on the infra repo."),
    svc: Services = Depends(services),
) -> DeliveryOverview:
    """Every app's Git pin, running tag and newest green build, side by side."""
    errors: dict[str, str] = {}

    apps = await _attempt("argocd", lambda: argocd.provider.get().list_apps(), errors) or []

    async def one(app: Any) -> AppDelivery:
        tracking, note, file_result = await _read_pins(app.name, app.path, errors, svc)
        return AppDelivery(
            name=app.name,
            sync=app.sync,
            health=app.health,
            revision=app.revision,
            path=app.path,
            tracking=tracking,
            note=note,
            components=(await _components(app.name, app.path, file_result, errors) if tracking == "kustomize" else []),
        )

    rows = list(await asyncio.gather(*(one(app) for app in apps))) if apps else []

    pull_requests: list[PullRequestView] = []
    if include_prs:
        repo = svc.settings.github_infra_repo
        found = await _attempt("github.prs", lambda: github.provider.get().list_prs(repo, state="open"), errors) or []
        pull_requests = [
            PullRequestView(
                repo=repo,
                number=pr["number"],
                title=pr["title"],
                state=pr["state"],
                head=pr["head"],
                base=pr["base"],
                draft=bool(pr.get("draft")),
                url=pr.get("url", ""),
            )
            for pr in found
        ]

    return DeliveryOverview(apps=rows, pull_requests=pull_requests, errors=errors)
