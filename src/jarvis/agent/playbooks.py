"""Playbooks: the prompts a button sends.

The proactive half of the dashboard is still manual — a person clicks
"Investigate" — but what that click asks should not depend on how the person
would have phrased it. A playbook turns structured context (an alert, a digest)
into the opening message of a fresh conversation, with every identifier the
agent needs already in it, so the first turn goes to looking rather than asking.

They are ordinary user messages: they reach the graph through the same chat
endpoint, pass the same gate, and show up in the session history as what the
person sent.
"""

from __future__ import annotations

from datetime import timezone

from jarvis.core.console import AlertView, EventRecord, PodDetail
from jarvis.core.types import ArgoAppStatus

_NOISY_LABELS = frozenset({"prometheus", "endpoint", "instance", "job", "service", "uid", "alertname", "severity"})


def _duration(seconds: float) -> str:
    if seconds < 3600:
        return f"{seconds / 60:.0f} minutes"
    if seconds < 86_400:
        return f"{seconds / 3600:.1f} hours"
    return f"{seconds / 86_400:.1f} days"


def investigate_alert(alert: AlertView) -> str:
    """The opening message for investigating one alert.

    Args:
        alert: The alert, as Alertmanager reports it.

    Returns:
        A self-contained request: what fired, about what, since when, and what a
        good answer looks like.
    """
    lines = [
        "Investigate this alert from Alertmanager. Find the cause and show the evidence "
        "(events, metrics, log lines). If a fix is needed, propose it as a pull request; "
        "do not open one until I agree.",
        "",
        f"Alert: {alert.name} ({alert.severity or 'no severity'})",
    ]
    if alert.starts_at is not None:
        started = alert.starts_at.astimezone(timezone.utc)
        lines.append(f"Firing for: {_duration(alert.age)}, since {started:%Y-%m-%d %H:%M} UTC")
    subject = "/".join(part for part in (alert.namespace, alert.target) if part)
    if subject:
        lines.append(f"About: {subject}" + (f" (container {alert.container})" if alert.container else ""))
    if alert.summary:
        lines.append(f"Summary: {alert.summary}")
    if alert.description and alert.description != alert.summary:
        lines.append(f"Description: {alert.description}")
    if alert.runbook_url:
        lines.append(f"Runbook: {alert.runbook_url}")
    extra = {k: v for k, v in sorted(alert.labels.items()) if k not in _NOISY_LABELS}
    if alert.target and not alert.target.startswith("Pod/"):
        # The exporter's pod, not the subject: leaving it in invites the wrong lookup.
        extra.pop("pod", None)
        if extra.get("container") == "kube-state-metrics":
            extra.pop("container")
    if extra:
        lines.append("Labels: " + ", ".join(f"{k}={v}" for k, v in extra.items()))
    return "\n".join(lines)


def investigate_pod(pod: PodDetail, events: list[EventRecord]) -> str:
    """The opening message for a pod that is not Running-and-ready.

    Args:
        pod: The pod as the console describes it.
        events: Recent events about it, newest first.

    Returns:
        What state it is in, why the kubelet says so, and what to look at first.
    """
    lines = [
        "Investigate this pod: it is not Running and ready. Find the cause and show the evidence "
        "(container state, the previous container's log if it restarted, events). If a fix is "
        "needed, propose it as a pull request; do not open one until I agree.",
        "",
        f"Pod: {pod.namespace}/{pod.name}",
        f"Phase: {pod.phase}, ready {pod.ready or '?'}, {pod.restarts} restarts",
    ]
    if pod.owner:
        lines.append(f"Owner: {pod.owner}")
    if pod.reason or pod.message:
        lines.append(f"Status: {' — '.join(p for p in (pod.reason, pod.message) if p)}")
    for c in pod.init_containers + pod.containers:
        state = c.state + (f" ({c.reason})" if c.reason else "")
        last = f", last exit {c.last_exit_code} {c.last_reason}".rstrip() if c.last_exit_code is not None else ""
        lines.append(f"Container {c.name}: {state}, {c.restarts} restarts{last}")
    if pod.node:
        lines.append(f"Node: {pod.node}")
    for event in events[:5]:
        lines.append(f"Event: {event.type} {event.reason} ×{event.count}: {event.message}")
    return "\n".join(lines)


def investigate_argo_app(app: ArgoAppStatus) -> str:
    """The opening message for an ArgoCD app that is not Synced and Healthy.

    Args:
        app: The application as ArgoCD reports it.

    Returns:
        Its state and where its desired state lives, so the agent can compare Git with the cluster.
    """
    lines = [
        "Investigate this ArgoCD application: it is not Synced and Healthy. Compare what Git "
        "declares with what runs in the cluster, find which resources differ or are unhealthy "
        "and why. If a fix is needed, propose it as a pull request; do not open one until I agree.",
        "",
        f"Application: {app.name}",
        f"Sync: {app.sync}, health: {app.health}",
    ]
    if app.revision:
        lines.append(f"Revision: {app.revision}")
    if app.repo:
        lines.append(f"Source: {app.repo}" + (f" path {app.path}" if app.path else ""))
    return "\n".join(lines)


__all__ = ["investigate_alert", "investigate_argo_app", "investigate_pod"]
