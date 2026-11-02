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
from quaerium.agents import (
    AgentRunner,
    AnthropicLLM,
    build_audit_log,
    build_graph,
    build_session_store,
    checkpointer,
    configure_logging,
    get_logger,
)
from quaerium.agents.server import make_approvals_router, make_runs_router

from jarvis import gateway as gateway_usage
from jarvis.agent.models import ModelCatalog
from jarvis.agent.nodes.router import classify
from jarvis.agent.policy import build_policy
from jarvis.agent.prompts import ROUTER_SYSTEM, build_system
from jarvis.api.deps import Services, services
from jarvis.api.routers import alerts, chat, console, delivery, gateway, health, push, status
from jarvis.notify import Notifier, build_notifier
from jarvis.settings import Settings, get_settings
from jarvis.tools import build_registry, close_capabilities

logger = get_logger(__name__)

APP_NAME = "jarvis"
"""Namespace of Jarvis's data in the shared stores: Redis keys, audit tables."""

LEGACY_TYPES_MODULE = "jarvis.core.types"
"""Where the agent types lived before the kernel moved to Quaerium. Checkpoints
written before that still name it; see :func:`quaerium.agents.checkpointer.build_serde`."""

EFFORT_FOR_ROUTE = {"chitchat": "low", "question": "medium"}
"""Reading the lab is cheaper than changing it: only actions get the full effort."""


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
    policy = build_policy()
    sessions = build_session_store(settings.redis_url, prefix=APP_NAME, ttl=settings.session_ttl_seconds)
    audit, pool = await build_audit_log(settings.database_url, table_prefix=APP_NAME)
    notifier: Notifier = getattr(app.state, "notifier_override", None) or build_notifier(settings)

    async with AsyncExitStack() as stack:
        saver = await stack.enter_async_context(
            checkpointer(settings.database_url, legacy_modules=[LEGACY_TYPES_MODULE])
        )
        models = ModelCatalog(settings)
        stack.push_async_callback(models.aclose)

        llm: Any = getattr(app.state, "llm_override", None)
        if llm is None:
            if settings.has_anthropic and settings.anthropic_api_key is not None:
                llm = AnthropicLLM(
                    api_key=settings.anthropic_api_key.get_secret_value(),
                    model=settings.model,
                    max_tokens=settings.max_tokens,
                    gateway_url=settings.llm_gateway_url,
                    risk_of=registry.risk_of,
                )
            else:
                logger.warning("llm.unavailable", reason="ANTHROPIC_API_KEY is not set")

        runner: Any = None
        if llm is not None:
            graph = build_graph(
                llm=llm,
                registry=registry,
                system=build_system(),
                classify=classify,
                router_llm=None,
                router_system=ROUTER_SYSTEM,
                effort=settings.effort,
                effort_for_route=EFFORT_FOR_ROUTE,
                max_steps=settings.max_graph_steps,
                policy=policy,
                checkpointer=saver,
                **audit.hooks(),
            )
            runner = AgentRunner(graph=graph, sessions=sessions, audit=audit)
            # The audit log came back from Postgres; the checkpointer knows which runs still wait.
            await runner.restore_pending()

        app.state.services = Services(
            settings=settings,
            registry=registry,
            policy=policy,
            runner=runner,
            sessions=sessions,
            audit=audit,
            llm_ready=llm is not None,
            models=models,
            notifier=notifier,
        )

        logger.info(
            "jarvis.ready",
            tools=len(registry),
            model=settings.model,
            gateway=bool(settings.llm_gateway_url),
            fake_tools=settings.fake_tools,
            durable=app.state.services.durable,
            notify=notifier.available,
        )
        yield
        if runner is not None:
            await runner.aclose()

    await close_capabilities()
    await gateway_usage.provider.aclose()
    await notifier.aclose()
    await sessions.aclose()
    if pool is not None:
        await pool.close()
    logger.info("jarvis.stopped")


def create_app(*, llm: Any = None, notifier: Notifier | None = None) -> FastAPI:
    """Build the ASGI application.

    Args:
        llm: Replace the model. Used by tests; never set in production.
        notifier: Replace the notify-hub client. Used by tests; never set in production.
    """
    settings = get_settings()
    app = FastAPI(
        title="Ultron",
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
    app.include_router(health.router)
    app.include_router(chat.router)
    app.include_router(make_approvals_router(services))
    app.include_router(status.router)
    app.include_router(make_runs_router(services))
    for module in (console, delivery, alerts, gateway, push):
        app.include_router(module.router)

    _mount_spa(app)
    app.state.llm_override = llm
    app.state.notifier_override = notifier
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
    root = dist.resolve()

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
        # Files at the root of dist (sw.js, the manifest, icons, splash screens)
        # are served as themselves; resolve() keeps ../ from leaving dist.
        if path:
            file = (dist / path).resolve()
            if file.is_file() and file.is_relative_to(root):
                return FileResponse(file)
        return FileResponse(dist / "index.html")

    logger.info("spa.mounted", path=str(dist))


app = create_app()

__all__ = ["app", "create_app", "lifespan"]
