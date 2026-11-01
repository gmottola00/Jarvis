"""Status: "is everything fine?", answered in one call.

Every source that can say something is wrong — pods, nodes, ArgoCD,
Alertmanager, recent warning events, the local model host, runs waiting at the
gate — is asked concurrently and flattened into one list of ``Problem``s,
worst first. A dead upstream is recorded in ``errors``
and costs its own rows, never the page.

``GET /api/status/brief`` is the bridge to the agent: it renders the playbook
for one problem, and the page sends it as the first message of a new chat.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from quaerium.agents.llm import is_native

from jarvis import gateway
from jarvis.agent.playbooks import investigate_alert, investigate_argo_app, investigate_pod
from jarvis.api.deps import Services, services
from jarvis.api.fetch import attempt, upstream_http_error
from jarvis.api.routers.gateway import merge_models
from jarvis.core.console import AlertView, EventRecord, KeyUsage, ModelUsage, PodDetail
from jarvis.core.types import ArgoAppStatus, NodeStatus, Problem, StatusCounts, StatusView
from jarvis.exceptions import ConfigurationError, UpstreamError
from jarvis.tools import alertmanager, argocd, k8s

router = APIRouter(prefix="/api/status", tags=["status"])


#: Warning events shown on the status page; the cluster's events tab has the rest.
MAX_EVENTS = 10

#: Pod reasons that will not fix themselves by waiting.
_BROKEN_REASONS = frozenset(
    {"CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "OOMKilled", "Error", "CreateContainerConfigError"}
)


class Brief(BaseModel):
    prompt: str


async def _alerts() -> list[AlertView]:
    """Active alerts, or none when Alertmanager is not configured.

    Alerts are an addition, not part of what makes the lab healthy: an install
    without Alertmanager must not show a problem forever because of a setting
    it never meant to have.
    """
    try:
        client = alertmanager.provider.get()
    except ConfigurationError:
        return []
    alerts: list[AlertView] = await client.alerts()
    return alerts


def _app_link(namespace: str, tab: str) -> str:
    return f"#cluster/apps/{namespace}/{tab}"


def _workload_of(pod: PodDetail) -> str:
    """The workload that owns a pod, read from its owner reference.

    A Deployment owns its pods through a ReplicaSet named ``<deployment>-<template hash>``;
    the hash never contains a dash, so dropping the last segment is exact.
    Empty for a bare pod or a Job's.
    """
    kind, _, owner = pod.owner.partition("/")
    if kind == "ReplicaSet":
        return owner.rsplit("-", 1)[0]
    return owner if kind in {"StatefulSet", "DaemonSet"} else ""


def _needs_look(pod: PodDetail) -> bool:
    """Not Running-and-ready. A finished Job pod (Succeeded) is done, not broken."""
    return pod.phase != "Succeeded" and not pod.healthy


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


def _pod_problems(pods: list[PodDetail]) -> list[Problem]:
    return [
        Problem(
            id=f"pod:{p.namespace}/{p.name}",
            kind="pod",
            severity="bad" if p.phase == "Failed" or p.reason in _BROKEN_REASONS else "warn",
            title=f"{p.name} is {p.reason or p.phase}",
            namespace=p.namespace,
            name=p.name,
            detail=f"{p.phase} · ready {p.ready or '?'} · {p.restarts} restarts",
            link="/".join(filter(None, (_app_link(p.namespace, "logs"), _workload_of(p)))),
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


def _event_problems(events: list[EventRecord], covered: set[str], live_pods: set[str] | None) -> list[Problem]:
    """Warning events, one row per object.

    Skips objects already listed as a problem pod, and — when the pod list is
    known — events about pods that no longer exist: a rollout leaves a
    "readiness probe failed" behind on the pod it just deleted, which is
    history, not a problem, and cannot be investigated.
    """
    seen: set[str] = set()
    rows: list[Problem] = []
    for e in events:
        key = f"{e.namespace}/{e.object}"
        if not e.warning or key in seen or key in covered:
            continue
        if live_pods is not None and e.object.startswith("Pod/") and key not in live_pods:
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


#: A key past this share of its budget is worth a look; at 1.0 LiteLLM starts refusing it.
BUDGET_WARN = 0.8
#: A model with at least this many requests in 24h and this failure rate is failing, not unlucky.
FAILURE_MIN_REQUESTS = 5
FAILURE_RATE = 0.2


async def _gateway_usage() -> tuple[list[KeyUsage], list[ModelUsage]] | None:
    """Key budgets and the last 24h per model, or None when the gateway view is not configured."""
    try:
        client = gateway.provider.get()
    except ConfigurationError:
        return None
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    budgets, rows = await asyncio.gather(client.key_budgets(), client.usage(since))
    return budgets, merge_models(rows)


def _budget_problems(keys: list[KeyUsage]) -> list[Problem]:
    rows = []
    for k in keys:
        used = k.budget_used
        if used is None or used < BUDGET_WARN:
            continue
        resets = f" (resets {k.budget_reset_at:%b %d})" if k.budget_reset_at else ""
        rows.append(
            Problem(
                id=f"gateway:budget:{k.alias}",
                kind="gateway",
                severity="bad" if used >= 1 else "warn",
                title=f"{k.alias} at {used:.0%} of its ${k.max_budget:g} budget{resets}",
                name=k.alias,
                detail=f"${k.spend:.2f} spent" + (f" per {k.budget_duration}" if k.budget_duration else ""),
                link="#settings",
                investigable=False,
            )
        )
    return rows


def _model_failure_problems(models: list[ModelUsage]) -> list[Problem]:
    return [
        Problem(
            id=f"gateway:failures:{m.model}",
            kind="gateway",
            severity="warn",
            title=f"{m.model}: {m.failures}/{m.requests} requests failed in 24h",
            name=m.model,
            detail="see recent errors in settings",
            link="#settings",
            investigable=False,
        )
        for m in models
        if m.requests >= FAILURE_MIN_REQUESTS and m.failures / m.requests > FAILURE_RATE
    ]


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

    # Started first and awaited last: asyncio.gather is only typed up to six awaitables.
    llm_task = asyncio.create_task(attempt("litellm", _gateway_usage, errors))
    nodes, pods, apps, alerts, events, gpu = await asyncio.gather(
        attempt("k8s.nodes", lambda: client().list_nodes(), errors),
        attempt("k8s.pods", lambda: client().pod_details("all"), errors),
        attempt("argocd.apps", lambda: argocd.provider.get().list_apps(), errors),
        attempt("alertmanager.alerts", _alerts, errors),
        attempt("k8s.events", lambda: client().events("all", limit=200), errors),
        attempt("models.gpu", svc.models.gpu, errors),
    )
    llm = await llm_task
    nodes, apps, alerts, events = nodes or [], apps or [], alerts or [], events or []
    live_pods = None if pods is None else {f"{p.namespace}/Pod/{p.name}" for p in pods}
    pods = [p for p in pods or [] if _needs_look(p)]
    pending = svc.audit.pending()

    problems = _node_problems(nodes) + _pod_problems(pods) + _argo_problems(apps) + _alert_problems(alerts)
    problems += _event_problems(events, covered={f"{p.namespace}/Pod/{p.name}" for p in pods}, live_pods=live_pods)
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
                link="#settings",
                investigable=False,
            )
        )
    if llm is not None:
        problems += _budget_problems(llm[0]) + _model_failure_problems(llm[1])
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


async def _pod_brief(namespace: str, name: str) -> str:
    client = k8s.provider.get()
    pod = await client.pod_detail(namespace, name)
    events = [e for e in await client.events(namespace, limit=200) if e.object == f"Pod/{name}"]
    return investigate_pod(pod, events)


async def _argo_brief(name: str) -> str:
    app = next((a for a in await argocd.provider.get().list_apps() if a.name == name), None)
    if app is None:
        raise HTTPException(status_code=404, detail=f"no ArgoCD application {name}")
    return investigate_argo_app(app)


async def _alert_brief(fingerprint: str) -> str:
    try:
        client = alertmanager.provider.get()
    except ConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    alert = next((a for a in await client.alerts(include_suppressed=True) if a.fingerprint == fingerprint), None)
    if alert is None:
        raise HTTPException(status_code=404, detail=f"no firing alert {fingerprint}; it may have resolved")
    return investigate_alert(alert)


async def _event_brief(namespace: str, ref: str) -> str:
    """An event about a pod is investigated as that pod; anything else as the event itself."""
    kind, _, obj = ref.partition("/")
    if kind == "Pod" and obj:
        return await _pod_brief(namespace, obj)
    events = await k8s.provider.get().events(namespace or "all", limit=200)
    event = next((e for e in events if e.object == ref and e.warning), None)
    if event is None:
        raise HTTPException(status_code=404, detail=f"no warning event for {namespace}/{ref}")
    return (
        "Investigate this Kubernetes warning event and tell me whether it needs action.\n\n"
        f"Object: {namespace}/{event.object}\nReason: {event.reason} ×{event.count}\nMessage: {event.message}"
    )


@router.get("/brief", response_model=Brief)
async def brief(
    kind: Literal["pod", "argo", "alert", "event"] = Query(...),
    name: str = Query(..., min_length=1),
    namespace: str = Query(""),
) -> Brief:
    """The investigation prompt for one problem, ready to send as a chat message."""
    try:
        if kind == "pod":
            prompt = await _pod_brief(namespace, name)
        elif kind == "argo":
            prompt = await _argo_brief(name)
        elif kind == "alert":
            prompt = await _alert_brief(name)
        else:
            prompt = await _event_brief(namespace, name)
    except UpstreamError as exc:
        raise upstream_http_error(exc) from exc
    return Brief(prompt=prompt)
