"""Chat: the streaming endpoint and session listing."""

from __future__ import annotations

from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from jarvis.agent.models import UnknownModelError
from jarvis.api.deps import Services, services
from jarvis.api.sse import stream
from jarvis.core.types import ErrorEvent, new_id

router = APIRouter(prefix="/api", tags=["chat"])


class ChatRequest(BaseModel):
    session_id: str = Field(default="", description="Omit to start a new session.")
    message: str
    model: str = Field(default="", description="A model id from /api/models. Omit for the default.")


class SessionResponse(BaseModel):
    session_id: str


@router.post("/sessions", response_model=SessionResponse)
async def create_session() -> SessionResponse:
    """Mint a session id. Also the checkpointer thread id."""
    return SessionResponse(session_id=new_id("ses"))


@router.get("/sessions")
async def list_sessions(svc: Services = Depends(services)) -> list[dict[str, Any]]:
    """List known sessions, for the sidebar."""
    sessions: list[dict[str, Any]] = await svc.sessions.sessions()
    return sessions


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, svc: Services = Depends(services)) -> dict[str, Any]:
    """Return a session's visible history and any approval it is waiting on.

    The pending approval is what lets a reloaded page restore its dialog instead
    of losing track of a suspended run.
    """
    turns = await svc.sessions.history(session_id, limit=100)
    return {
        "session_id": session_id,
        "turns": [t.model_dump(mode="json") for t in turns],
        "pending_approval": await svc.runner.pending_approval(session_id),
    }


@router.post("/chat")
async def chat(request: ChatRequest, svc: Services = Depends(services)) -> Any:
    """Run a turn and stream its events.

    The stream ends on ``done``, on ``approval_required`` (the run is suspended
    and durable), or on ``error``.
    """
    session_id = request.session_id or new_id("ses")

    if not svc.llm_ready:

        async def refuse() -> AsyncIterator[dict[str, Any]]:
            yield ErrorEvent(
                message="ANTHROPIC_API_KEY is not set, so I cannot think. " "The lab dashboard still works without it."
            ).model_dump(mode="json")

        return stream(refuse())

    try:
        model = await svc.models.resolve(request.model)
    except UnknownModelError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return stream(svc.runner.start(session_id, request.message, model=model))
