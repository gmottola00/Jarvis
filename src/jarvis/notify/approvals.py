"""The one push Jarvis sends on its own: a run is waiting for your approval.

Wired as the runner's ``on_suspend``. The kernel runs it in the background, so
the SSE stream never waits for the hub; tapping the notification opens the
approvals page.
"""

from __future__ import annotations

from quaerium.agents import ApprovalRequiredEvent, OnSuspend

from jarvis.notify.client import Notifier

APPROVALS_URL = "/#jarvis/approvals"


def notify_approval(notifier: Notifier) -> OnSuspend:
    """Build the ``on_suspend`` callback that pushes "Approval needed" through ``notifier``."""

    async def on_suspend(event: ApprovalRequiredEvent) -> None:
        if not notifier.available:
            return
        await notifier.notify(
            "Approval needed",
            f"{event.tool}: {event.why}" if event.why else event.tool,
            url=APPROVALS_URL,
            tag=f"approval:{event.run_id}",
            urgency="high",
        )

    return on_suspend


__all__ = ["APPROVALS_URL", "notify_approval"]
