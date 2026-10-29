"""The console: Kubernetes, read directly.

Nothing in this module goes near the agent. No model, no tools, no approvals —
these endpoints call the capability clients and return structured data, and a
page built on them answers "what is the cluster doing" in one round trip instead
of a conversation.

That split is deliberate. Asking a language model for the state of a cluster
costs tokens, takes seconds, and gives you prose you then have to trust. A table
is faster, free, and exact. The agent is for *deciding* and *changing*; the
console is for *looking*. Jarvis should be good at both and should not confuse
them.

Every endpoint is a read, and like the lab overview, every failure is captured
per capability rather than raised: one unreachable upstream degrades one card.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator, Awaitable, Callable, TypeVar

from fastapi import APIRouter, HTTPException, Query

from jarvis.api.sse import stream
from jarvis.core.console import (
    ClusterSnapshot,
    EventRecord,
    MetricsView,
    NamespaceSummary,
    NetworkView,
    NodeDetail,
    PodDetail,
    ReplicaSetView,
    WorkloadDetail,
    WorkloadSummary,
)
from jarvis.exceptions import UpstreamError
from jarvis.logging import get_logger
from jarvis.tools import k8s

logger = get_logger(__name__)
router = APIRouter(prefix="/api/k8s", tags=["console"])

T = TypeVar("T")


def _client() -> Any:
    """The Kubernetes client — live or faked, depending on settings."""
    return k8s.provider.get()


async def _attempt(name: str, call: Callable[[], Awaitable[T]], errors: dict[str, str]) -> T | None:
    """Run one fetch, recording the failure instead of propagating it."""
    try:
        return await call()
    except Exception as exc:  # noqa: BLE001 - a dead upstream is a card, not a 500
        errors[name] = f"{type(exc).__name__}: {exc}"
        logger.warning("console.fetch_failed", target=name, error=str(exc))
        return None


def _fail(exc: Exception) -> HTTPException:
    """Turn an upstream failure into a status code the browser can act on."""
    status = getattr(exc, "status", None)
    return HTTPException(status_code=status if isinstance(status, int) and status >= 400 else 502, detail=str(exc))


# ============================================================================
# Snapshot
# ============================================================================


@router.get("/snapshot", response_model=ClusterSnapshot)
async def snapshot() -> ClusterSnapshot:
    """Everything the console's landing page needs, in one call.

    Pods are fetched once and threaded into the node and namespace views, so
    "how full is um790" and "how many pods in tickup" cost nothing extra.
    """
    errors: dict[str, str] = {}
    client = _client()

    pods = await _attempt("pods", lambda: client.pod_details("all"), errors) or []

    nodes, namespaces, workloads, events, metrics = await asyncio.gather(
        _attempt("nodes", lambda: client.node_details(pods=pods), errors),
        _attempt("namespaces", lambda: client.namespaces(pods=pods), errors),
        _attempt("workloads", lambda: client.workloads("all"), errors),
        _attempt("events", lambda: client.events("all", limit=200), errors),
        _attempt("metrics", lambda: client.metrics(), errors),
    )

    warnings = [e for e in (events or []) if e.type == "Warning"][:25]

    return ClusterSnapshot(
        nodes=nodes or [],
        namespaces=namespaces or [],
        workloads=workloads or [],
        pods=pods,
        warnings=warnings,
        metrics=metrics or MetricsView(available=False, reason="not fetched"),
        errors=errors,
    )


# ============================================================================
# Inventory
# ============================================================================


@router.get("/namespaces", response_model=list[NamespaceSummary])
async def namespaces() -> list[NamespaceSummary]:
    """Namespaces with their pod and workload counts."""
    client = _client()
    try:
        pods = await client.pod_details("all")
        result: list[NamespaceSummary] = await client.namespaces(pods=pods)
        return result
    except UpstreamError as exc:
        raise _fail(exc) from exc


@router.get("/nodes", response_model=list[NodeDetail])
async def nodes() -> list[NodeDetail]:
    """Nodes with capacity, allocatable, conditions, taints and committed requests."""
    client = _client()
    try:
        pods = await client.pod_details("all")
        result: list[NodeDetail] = await client.node_details(pods=pods)
        return result
    except UpstreamError as exc:
        raise _fail(exc) from exc


@router.get("/workloads", response_model=list[WorkloadSummary])
async def workloads(namespace: str = Query("all")) -> list[WorkloadSummary]:
    """Deployments, StatefulSets and DaemonSets."""
    try:
        result: list[WorkloadSummary] = await _client().workloads(namespace)
        return result
    except UpstreamError as exc:
        raise _fail(exc) from exc


@router.get("/workloads/{namespace}/{name}", response_model=WorkloadDetail)
async def workload(namespace: str, name: str) -> WorkloadDetail:
    """One workload with its replica sets, its pods and its events.

    The replica sets are the point: a Deployment does not update pods, it
    creates a new ReplicaSet and scales the previous one to zero. Seeing the
    old ones lined up with their revision numbers is how that stops being
    folklore.
    """
    client = _client()
    errors: dict[str, str] = {}

    try:
        found = [w for w in await client.workloads(namespace) if w.name == name]
    except UpstreamError as exc:
        raise _fail(exc) from exc

    if not found:
        raise HTTPException(status_code=404, detail=f"no workload {namespace}/{name}")
    summary = found[0]

    pods = await _attempt("pods", lambda: client.pod_details(namespace), errors) or []
    selector = summary.selector or {"app": name}
    mine = [p for p in pods if all(p.labels.get(k) == v for k, v in selector.items())] or [
        p for p in pods if p.name.startswith(f"{name}-")
    ]

    replica_sets: list[ReplicaSetView] = []
    if summary.kind == "Deployment":
        replica_sets = (
            await _attempt("replicasets", lambda: client.replica_sets(namespace, selector=selector), errors) or []
        )

    events = await _attempt("events", lambda: client.events(namespace, limit=200), errors) or []
    names = {p.name for p in mine} | {name}
    related = [e for e in events if any(e.object.endswith(n) or n in e.object for n in names)][:40]

    return WorkloadDetail(workload=summary, replica_sets=replica_sets, pods=mine, events=related)


# ============================================================================
# Pods
# ============================================================================


@router.get("/pods", response_model=list[PodDetail])
async def pods(namespace: str = Query("all"), unhealthy: bool = Query(False)) -> list[PodDetail]:
    """Pods, fully described. ``unhealthy=true`` narrows to the ones to look at."""
    try:
        found: list[PodDetail] = await _client().pod_details(namespace)
    except UpstreamError as exc:
        raise _fail(exc) from exc
    return [p for p in found if not p.healthy] if unhealthy else found


@router.get("/pods/{namespace}/{name}", response_model=PodDetail)
async def pod(namespace: str, name: str) -> PodDetail:
    """One pod: containers, probes, resources, conditions, volumes."""
    try:
        result: PodDetail = await _client().pod_detail(namespace, name)
        return result
    except UpstreamError as exc:
        raise _fail(exc) from exc


@router.get("/pods/{namespace}/{name}/logs")
async def logs(
    namespace: str,
    name: str,
    container: str | None = Query(None),
    tail: int = Query(200, ge=1, le=5000),
) -> dict[str, Any]:
    """A pod's recent log, as one blob. Use ``/logs/stream`` to follow it."""
    try:
        text = await _client().pod_logs(namespace, name, tail=tail, container=container)
    except UpstreamError as exc:
        raise _fail(exc) from exc
    return {"namespace": namespace, "pod": name, "container": container, "text": text}


@router.get("/pods/{namespace}/{name}/logs/stream")
async def logs_stream(
    namespace: str,
    name: str,
    container: str | None = Query(None),
    tail: int = Query(200, ge=1, le=5000),
) -> Any:
    """Follow a pod's log over SSE.

    Reuses the chat stream's transport, so the browser has one parser for both.
    The client closing the connection cancels the upstream watch — that is what
    the ``finally`` in the client's ``follow_logs`` is for.
    """

    async def lines() -> AsyncIterator[dict[str, Any]]:
        client = _client()
        try:
            async for line in client.follow_logs(namespace, name, container=container, tail=tail):
                yield {"type": "line", "text": line}
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - the viewer gets a reason in-band
            yield {"type": "error", "message": f"{type(exc).__name__}: {exc}"}

    return stream(lines())


# ============================================================================
# Networking, events, manifests, metrics
# ============================================================================


@router.get("/network", response_model=NetworkView)
async def network(namespace: str = Query("all")) -> NetworkView:
    """Services and ingresses: the path from the tailnet down to a container port."""
    try:
        result: NetworkView = await _client().network(namespace)
        return result
    except UpstreamError as exc:
        raise _fail(exc) from exc


@router.get("/events", response_model=list[EventRecord])
async def events(
    namespace: str = Query("all"),
    limit: int = Query(200, ge=1, le=1000),
    warnings_only: bool = Query(False),
) -> list[EventRecord]:
    """Recent cluster events, newest first."""
    try:
        found: list[EventRecord] = await _client().events(namespace, limit=limit)
    except UpstreamError as exc:
        raise _fail(exc) from exc
    return [e for e in found if e.type == "Warning"] if warnings_only else found


@router.get("/manifest/{kind}/{namespace}/{name}")
async def manifest(kind: str, namespace: str, name: str) -> dict[str, Any]:
    """The live manifest of one object, with managed fields and secrets stripped.

    Reading this next to the file in ``Home-Lab-Infra`` is the exercise: every
    field you did not write is a default the API server chose for you.
    """
    try:
        result: dict[str, Any] = await _client().manifest(kind, namespace, name)
        return result
    except UpstreamError as exc:
        raise _fail(exc) from exc


@router.get("/metrics", response_model=MetricsView)
async def metrics() -> MetricsView:
    """Live CPU and memory, when metrics-server is installed.

    Returns ``available: false`` with a reason rather than an error when it is
    not — which is the current state of this lab, and a thing the console says
    out loud instead of showing an empty chart.
    """
    try:
        result: MetricsView = await _client().metrics()
        return result
    except UpstreamError as exc:
        return MetricsView(available=False, reason=str(exc))
