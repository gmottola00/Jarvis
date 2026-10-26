"""Runs: the audit trail."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from jarvis.api.deps import Services, services

router = APIRouter(prefix="/api", tags=["runs"])


@router.get("/runs")
async def list_runs(
    limit: int = 50, session_id: str | None = None, svc: Services = Depends(services)
) -> list[dict[str, Any]]:
    """List recent runs, newest first."""
    return svc.audit.recent(limit=limit, session_id=session_id)


@router.get("/runs/{run_id}")
async def get_run(run_id: str, svc: Services = Depends(services)) -> dict[str, Any]:
    """Return one run in full: prompt, tool calls, approvals, answer, usage."""
    run = svc.audit.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"run {run_id!r} not found")
    return run
