"""Status: "is everything fine?", answered in one call.

Every source that can say something is wrong — pods, nodes, ArgoCD,
Alertmanager, recent warning events, the local model host, runs waiting at the
gate — is asked concurrently and flattened into one list of ``Problem``s,
worst first. Like the lab overview, a dead upstream is recorded in ``errors``
and costs its own rows, never the page.

``GET /api/status/brief`` is the bridge to the agent: it renders the playbook
for one problem, and the page sends it as the first message of a new chat.
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Literal, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from jarvis.agent.llm import is_native
from jarvis.agent.playbooks import investigate_alert, investigate_argo_app, investigate_pod
from jarvis.api.deps import Services, services
from jarvis.core.console import AlertView, EventRecord
from jarvis.core.types import ArgoAppStatus, NodeStatus, PodStatus, Problem, StatusCounts, StatusView
from jarvis.exceptions import ConfigurationError, UpstreamError
from jarvis.logging import get_logger
from jarvis.tools import alertmanager, argocd, k8s

logger = get_logger(__name__)
router = APIRouter(prefix="/api/status", tags=["status"])

T = TypeVar("T")

#: Warning events shown on the status page; the cluster's events tab has the rest.
MAX_EVENTS = 10

#: Pod reasons that will not fix themselves by waiting.
_BROKEN_REASONS = frozenset(
    {"CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "OOMKilled", "Error", "CreateContainerConfigError"}
)


class Brief(BaseModel):
    prompt: str


async def _attempt(name: str, call: Callable[[], Awaitable[T]], errors: dict[str, str]) -> T | None:
    """Run one fetch, recording the failure instead of propagating it."""
    try:
        return await call()
    except Exception as exc:  # noqa: BLE001 - a dead upstream is a row, not a 500
        errors[name] = f"{type(exc).__name__}: {exc}"
        logger.warning("status.fetch_failed", target=name, error=str(exc))
        return None


async def _alerts() -> list[AlertView]:
    """Active alerts, or none when Alertmanager is not configured (see ``lab._firing_alerts``)."""
    try:
        client = alertmanager.provider.get()
    except ConfigurationError:
        return []
    alerts: list[AlertView] = await client.alerts()
    return alerts


def _app_link(namespace: str, tab: str) -> str:
    return f"#cluster/apps/{namespace}/{tab}"


def _workload_of(pod: str) -> str:
    """``tickup-web-8c9d7f6b5-zx8vn`` → ``tickup-web``: the Deployment behind a ReplicaSet pod.

    A guess from the naming convention, good enough for a link: a StatefulSet
    pod (``postgres-0``) loses only its ordinal, and the app page falls back to
    its default component when the name matches nothing.
    """
    parts = pod.split("-")
    if len(parts) >= 3 and len(parts[-1]) == 5 and 8 <= len(parts[-2]) <= 10:
        return "-".join(parts[:-2])
    return "-".join(parts[:-1]) if len(parts) > 1 and parts[-1].isdigit() else pod


def _node_problems(nodes: list[NodeStatus]) -> list[Problem]:
    return [
        Problem(
            id=f"node:{n.name}",
            kind="node",
            severity="bad",
            title=f"Node {n.name} is not Ready",
            name=n.name,
            detail=n.version,
            link="#cluster/nodes",
            investigable=False,
        )
        for n in nodes
        if not n.ready
    ]


def _pod_problems(pods: list[PodStatus]) -> list[Problem]:
    return [
        Problem(
            id=f"pod:{p.namespace}/{p.name}",
            kind="pod",
            severity="bad" if p.phase == "Failed" or p.reason in _BROKEN_REASONS else "warn",
            title=f"{p.name} is {p.reason or p.phase}",
            namespace=p.namespace,
            name=p.name,
            detail=f"{p.phase} · ready {p.ready or '?'} · {p.restarts} restarts",
            link=f"{_app_link(p.namespace, 'logs')}/{_workload_of(p.name)}",
        )
        for p in pods
    ]


def _argo_problems(apps: list[ArgoAppStatus]) -> list[Problem]:
    return [
        Problem(
            id=f"argo:{a.name}",
            kind="argo",
            severity="bad" if a.health in {"Degraded", "Missing"} else "warn",
            title=f"ArgoCD {a.name} is {a.sync} · {a.health}",
            namespace=a.name,
            name=a.name,
            detail=a.revision[:8] if a.revision else "",
            link="#delivery",
        )
        for a in apps
        if a.sync != "Synced" or a.health != "Healthy"
    ]


def _alert_problems(alerts: list[AlertView]) -> list[Problem]:
    return [
        Problem(
            id=f"alert:{a.fingerprint}",
            kind="alert",
            severity="bad" if a.severity == "critical" else "warn",
            title=f"{a.name} firing",
            namespace=a.namespace,
            name=a.fingerprint,
            detail=a.summary or a.target,
            since=a.starts_at,
            link="#status/alerts",
        )
        for a in alerts
        if a.state == "active"
    ]


def _event_problems(events: list[EventRecord], covered: set[str]) -> list[Problem]:
    """Warning events, one row per object, skipping objects already listed as a problem pod."""
    seen: set[str] = set()
    rows: list[Problem] = []
    for e in events:
        key = f"{e.namespace}/{e.object}"
        if not e.warning or key in seen or key in covered:
            continue
        seen.add(key)
        rows.append(
            Problem(
                id=f"event:{key}",
                kind="event",
                severity="warn",
                title=f"{e.reason} on {e.object}",
                namespace=e.namespace,
                name=e.object,
                detail=e.message + (f" (×{e.count})" if e.count > 1 else ""),
                link=_app_link(e.namespace, "events") if e.namespace else "#cluster/events",
            )
        )
        if len(rows) >= MAX_EVENTS:
            break
    return rows


def _approval_problems(pending: list[dict[str, Any]]) -> list[Problem]:
    return [
        Problem(
            id=f"approval:{p['run_id']}",
            kind="approval",
            severity="warn",
            title=f"Run waiting for approval: {p.get('tool', '?')}",
            name=str(p["run_id"]),
            detail=str(p.get("why") or p.get("prompt") or ""),
            link="#jarvis/approvals",
            investigable=False,
        )
        for p in pending
    ]


@router.get("", response_model=StatusView)
async def status(svc: Services = Depends(services)) -> StatusView:
    """Every problem in the lab, worst first, with the counts the readouts need."""
    errors: dict[str, str] = {}
    client = k8s.provider.get

    nodes, pods, apps, alerts, events, gpu = await asyncio.gather(
        _attempt("k8s.nodes", lambda: client().list_nodes(), errors),
        _attempt("k8s.pods", lambda: client().unhealthy_pods(), errors),
        _attempt("argocd.apps", lambda: argocd.provider.get().list_apps(), errors),
        _attempt("alertmanager.alerts", _alerts, errors),
        _attempt("k8s.events", lambda: client().events("all", limit=200), errors),
        _attempt("models.gpu", svc.models.gpu, errors),
    )
    nodes, pods, apps, alerts, events = nodes or [], pods or [], apps or [], alerts or [], events or []
    pending = svc.audit.pending()

    problems = _node_problems(nodes) + _pod_problems(pods) + _argo_problems(apps) + _alert_problems(alerts)
    problems += _event_problems(events, covered={f"{p.namespace}/Pod/{p.name}" for p in pods})
    # The GPU desktop is often off on purpose; that only matters when chat depends on it.
    if gpu is not None and not gpu.up and not is_native(svc.models.default):
        problems.append(
            Problem(
                id="gateway:gpu",
                kind="gateway",
                severity="bad",
                title="The GPU host is not answering",
                name=gpu.url,
                detail=f"default model {svc.models.default} runs on it",
                link="#settings/models",
                investigable=False,
            )
        )
    problems += _approval_problems(pending)
    problems.sort(key=lambda p: p.severity != "bad")

    counts = StatusCounts(
        nodes=len(nodes),
        nodes_ready=sum(n.ready for n in nodes),
        unhealthy_pods=len(pods),
        argo_apps=len(apps),
        argo_unhealthy=sum(1 for a in apps if a.sync != "Synced" or a.health != "Healthy"),
        alerts=sum(1 for a in alerts if a.state == "active"),
        approvals=len(pending),
        gpu_up=gpu.up if gpu is not None else None,
    )
    return StatusView(problems=problems, counts=counts, errors=errors)


@router.get("/brief", response_model=Brief)
async def brief(
    kind: Literal["pod", "argo", "alert", "event"] = Query(...),
    name: str = Query(..., min_length=1),
    namespace: str = Query(""),
) -> Brief:
    """The investigation prompt for one problem, ready to send as a chat message."""
    try:
        if kind == "event":
            ref_kind, _, obj = name.partition("/")
            if ref_kind == "Pod" and obj:
                kind, name = "pod", obj
            else:
                events = await k8s.provider.get().events(namespace or "all", limit=200)
                found = [e for e in events if e.object == name and e.warning]
                if not found:
                    raise HTTPException(status_code=404, detail=f"no warning event for {namespace}/{name}")
                e = found[0]
                return Brief(
                    prompt=(
                        f"Investigate this Kubernetes warning event and tell me whether it needs action.\n\n"
                        f"Object: {namespace}/{e.object}\nReason: {e.reason} ×{e.count}\nMessage: {e.message}"
                    )
                )

        if kind == "pod":
            client = k8s.provider.get()
            pod = await client.pod_detail(namespace, name)
            events = [e for e in await client.events(namespace, limit=200) if e.object == f"Pod/{name}"]
            return Brief(prompt=investigate_pod(pod, events))

        if kind == "argo":
            app = next((a for a in await argocd.provider.get().list_apps() if a.name == name), None)
            if app is None:
                raise HTTPException(status_code=404, detail=f"no ArgoCD application {name}")
            return Brief(prompt=investigate_argo_app(app))

        alert = next(
            (a for a in await alertmanager.provider.get().alerts(include_suppressed=True) if a.fingerprint == name),
            None,
        )
        if alert is None:
            raise HTTPException(status_code=404, detail=f"no firing alert {name}; it may have resolved")
        return Brief(prompt=investigate_alert(alert))
    except UpstreamError as exc:
        status = getattr(exc, "status", None)
        raise HTTPException(
            status_code=status if isinstance(status, int) and status >= 400 else 502, detail=str(exc)
        ) from exc
