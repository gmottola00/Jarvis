"""Approvals: answering a suspended run."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from jarvis.api.deps import Services, services
from jarvis.api.sse import stream

router = APIRouter(prefix="/api", tags=["approvals"])


class ApprovalRequest(BaseModel):
    session_id: str
    approved: bool


@router.get("/approvals")
async def overview(svc: Services = Depends(services)) -> dict[str, Any]:
    """Every run waiting at the gate, and the most recent decisions.

    ``durable`` is false without a database: the checkpointer is then in memory,
    and a restart forgets every waiting run.
    """
    return {
        "durable": bool(svc.settings.database_url),
        "pending": svc.audit.pending(),
        "decided": svc.audit.decisions(limit=20),
    }


@router.post("/approvals/{run_id}")
async def decide(run_id: str, request: ApprovalRequest, svc: Services = Depends(services)) -> Any:
    """Approve or decline a pending destructive action, and stream the continuation.

    The run resumes from its checkpoint, so this works after a page reload or a
    backend restart — as long as a database is configured.
    """
    return stream(svc.runner.resume(request.session_id, run_id, approved=request.approved))
