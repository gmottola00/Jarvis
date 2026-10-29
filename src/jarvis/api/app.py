"""FastAPI application.

The lifespan is where Jarvis is assembled: registry, stores, checkpointer, model
and graph, all built once and closed in order on shutdown.

Nothing here is required for the app to start. No API key means chat explains
itself and the dashboard still works; no database means the graph runs on an
in-memory checkpointer. Starting degraded and saying so beats refusing to boot.
"""

from __future__ import annotations

from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from jarvis.agent.checkpointer import checkpointer
from jarvis.agent.graph import build_graph
from jarvis.agent.llm import AnthropicLLM
from jarvis.agent.models import ModelCatalog
from jarvis.agent.runner import JarvisRunner
from jarvis.api.deps import Services
from jarvis.api.routers import alerts, approvals, chat, console, delivery, health, lab, runs
from jarvis.core.policy import PolicyGate
from jarvis.logging import configure_logging, get_logger
from jarvis.memory.session import build_session_store
from jarvis.observability.audit import build_audit_log
from jarvis.settings import Settings, get_settings
from jarvis.tools import build_registry, close_capabilities

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Build everything, serve, then tear it down in reverse.

    ``app.state.llm_override`` short-circuits model construction. That seam exists
    so tests can drive the real application — routers, SSE, checkpointer and all —
    with a scripted model and no API key.
    """
    settings: Settings = get_settings()
    configure_logging(level=settings.log_level, json_output=settings.log_json)

    registry = build_registry()
    policy = PolicyGate()
    sessions = build_session_store(settings)
    audit, pool = await build_audit_log(settings)

    async with AsyncExitStack() as stack:
        saver = await stack.enter_async_context(checkpointer(settings))
        models = ModelCatalog(settings)
        stack.push_async_callback(models.aclose)

        llm: Any = getattr(app.state, "llm_override", None)
        if llm is None:
            if settings.has_anthropic:
                llm = AnthropicLLM(settings, risk_of=registry.risk_of)
            else:
                logger.warning("llm.unavailable", reason="ANTHROPIC_API_KEY is not set")

        runner: Any = None
        if llm is not None:
            graph = build_graph(
                llm=llm,
                registry=registry,
                policy=policy,
                checkpointer=saver,
                router_llm=None,
                effort=settings.effort,
                max_steps=settings.max_graph_steps,
                on_result=lambda call, result: audit.record_tool_call(_current_run(), call, result),
                on_approval=lambda approval: audit.record_approval(approval.run_id, approval),
            )
            runner = JarvisRunner(graph=graph, sessions=sessions, audit=audit)

        app.state.services = Services(
            settings=settings,
            registry=registry,
            policy=policy,
            runner=runner,
            sessions=sessions,
            audit=audit,
            llm_ready=llm is not None,
            models=models,
        )

        logger.info(
            "jarvis.ready",
            tools=len(registry),
            model=settings.model,
            gateway=bool(settings.llm_gateway_url),
            fake_tools=settings.fake_tools,
            durable=bool(settings.database_url),
        )
        yield

    await close_capabilities()
    await sessions.aclose()
    if pool is not None:
        await pool.close()
    logger.info("jarvis.stopped")


def _current_run() -> str:
    """Read the run id bound to the current async context by the runner."""
    import structlog

    return str(structlog.contextvars.get_contextvars().get("run_id", ""))


def create_app(*, llm: Any = None) -> FastAPI:
    """Build the ASGI application.

    Args:
        llm: Replace the model. Used by tests; never set in production.
    """
    settings = get_settings()
    app = FastAPI(
        title="Jarvis",
        description="An agent that operates the home lab. Reads freely, writes only to Git.",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # The console routers come before the SPA mount, which claims everything else.
    for module in (health, chat, approvals, lab, runs, console, delivery, alerts):
        app.include_router(module.router)

    _mount_spa(app)
    app.state.llm_override = llm
    return app


def _mount_spa(app: FastAPI) -> None:
    """Serve the built dashboard from ``web/dist`` when it exists.

    In the container nginx does this, matching how trip-ai and tickup are laid
    out. Locally, mounting it here means ``uvicorn`` alone serves the whole
    application - one process, one port, no Node required after the build.
    """
    dist = Path(__file__).resolve().parents[3] / "web" / "dist"
    if not (dist / "index.html").exists():
        return

    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/", include_in_schema=False)
    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str = "") -> FileResponse:
        """Return the SPA shell for any non-API path, so client routing works.

        Unmatched ``/api`` paths are excluded deliberately: letting them fall
        through would answer a typo'd endpoint with 200 and a page of HTML,
        which is a miserable thing to debug.
        """
        if path.startswith("api/") or path == "api":
            raise HTTPException(status_code=404, detail=f"no such endpoint: /{path}")
        return FileResponse(dist / "index.html")

    logger.info("spa.mounted", path=str(dist))


app = create_app()

__all__ = ["app", "create_app", "lifespan"]
