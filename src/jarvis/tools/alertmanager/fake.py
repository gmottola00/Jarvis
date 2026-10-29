"""Offline stand-in for Alertmanager.

The same three alerts the real lab fired for a crash-looping tickup backend,
renamed onto the fixture pods — including ``KubeDeploymentReplicasMismatch``
with the kube-state-metrics pod in its ``pod`` label, which is the case target
resolution exists for. Plus the ``Watchdog`` heartbeat that is always firing,
and one silenced alert, so both filters have something to filter.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from jarvis.core.console import AlertView
from jarvis.tools.alertmanager.client import HEARTBEATS, sort_alerts, to_view

_RUNBOOKS = "https://runbooks.prometheus-operator.dev/runbooks"
_KSM = {
    "container": "kube-state-metrics",
    "endpoint": "http",
    "job": "kube-state-metrics",
    "pod": "kube-prometheus-stack-kube-state-metrics-5f6764465d-d6c7j",
    "service": "kube-prometheus-stack-kube-state-metrics",
}


def _alert(
    fingerprint: str, hours: float, labels: dict[str, str], annotations: dict[str, str], *, state: str = "active"
) -> dict[str, Any]:
    started = datetime.now(timezone.utc) - timedelta(hours=hours)
    return {
        "fingerprint": fingerprint,
        "labels": {"prometheus": "monitoring/kube-prometheus-stack-prometheus", **labels},
        "annotations": annotations,
        "startsAt": started.isoformat().replace("+00:00", "Z"),
        "status": {"state": state, "silencedBy": [], "inhibitedBy": []},
    }


_ALERTS = [
    _alert(
        "59917779b926e5e6",
        13,
        {
            **_KSM,
            "alertname": "KubePodCrashLooping",
            "severity": "warning",
            "namespace": "tickup",
            "pod": "tickup-backend-5f7c8d9b6-qw3rt",
            "container": "backend",
            "reason": "CrashLoopBackOff",
        },
        {
            "summary": "Pod is crash looping.",
            "description": 'Pod tickup/tickup-backend-5f7c8d9b6-qw3rt (backend) is in waiting state (reason: "CrashLoopBackOff") on cluster .',
            "runbook_url": f"{_RUNBOOKS}/kubernetes/kubepodcrashlooping",
        },
    ),
    _alert(
        "5c3a21e4d750edc2",
        13,
        {
            **_KSM,
            "alertname": "KubeDeploymentReplicasMismatch",
            "severity": "warning",
            "namespace": "tickup",
            "deployment": "tickup-backend",
        },
        {
            "summary": "Deployment has not matched the expected number of replicas.",
            "description": "Deployment tickup/tickup-backend has not matched the expected number of replicas for longer than 15 minutes.",
            "runbook_url": f"{_RUNBOOKS}/kubernetes/kubedeploymentreplicasmismatch",
        },
    ),
    _alert(
        "c50bd7eb7179b656",
        1.2,
        {
            "alertname": "KubePodNotReady",
            "severity": "warning",
            "job": "kube-state-metrics",
            "namespace": "tickup",
            "pod": "tickup-web-8c9d7f6b5-zx8vn",
        },
        {
            "summary": "Pod has been in a non-ready state for more than 15 minutes.",
            "description": "Pod tickup/tickup-web-8c9d7f6b5-zx8vn has been in a non-ready state for longer than 15 minutes.",
            "runbook_url": f"{_RUNBOOKS}/kubernetes/kubepodnotready",
        },
    ),
    _alert(
        "1e0c9b77a2f4d310",
        30,
        {
            "alertname": "CPUThrottlingHigh",
            "severity": "info",
            "namespace": "kube-system",
            "pod": "svclb-traefik-x2k8p",
            "container": "lb-tcp-80",
        },
        {
            "summary": "Processes experience elevated CPU throttling.",
            "runbook_url": f"{_RUNBOOKS}/kubernetes/cputhrottlinghigh",
        },
        state="suppressed",
    ),
    _alert(
        "7da76e02b5888fb5",
        13.3,
        {"alertname": "Watchdog", "severity": "none"},
        {"summary": "An alert that should always be firing to certify that Alertmanager is working properly."},
    ),
]


class FakeAlertmanagerClient:
    """Serves the fixtures above."""

    async def alerts(self, *, include_suppressed: bool = False, include_heartbeats: bool = False) -> list[AlertView]:
        views = [to_view(raw) for raw in _ALERTS]
        if not include_suppressed:
            views = [v for v in views if v.state == "active"]
        if not include_heartbeats:
            views = [v for v in views if v.name not in HEARTBEATS]
        return sort_alerts(views)

    async def aclose(self) -> None:
        return None


__all__ = ["FakeAlertmanagerClient"]
