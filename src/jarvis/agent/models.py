"""Which models a run can use, and whether the local ones can answer right now.

The gateway is the source of truth for the list: ``/v1/models`` with Jarvis's
virtual key returns exactly the models that key may call. Without a gateway the
list is just the configured default.

Local models live on a desktop that is not always on. The gateway would fall
back to Claude by itself, but only after its first-token timeout, so the
catalog probes Ollama directly — a cheap ``/api/tags`` with a short timeout,
cached — and a run that asked for a local model while the machine is off goes
straight to the fallback model instead.

Example:
    >>> catalog = ModelCatalog(settings)                     # doctest: +SKIP
    >>> await catalog.resolve("local/qwen3-30b")             # doctest: +SKIP
    'claude-haiku-4-5'  # the GPU machine is off
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, Literal

import httpx

from jarvis.agent.llm import is_native
from jarvis.logging import get_logger
from jarvis.settings import Settings

logger = get_logger(__name__)

MODELS_TTL = 60.0
PROBE_TTL = 30.0
PROBE_TIMEOUT = 1.5


@dataclass(frozen=True)
class ModelInfo:
    """One selectable model."""

    id: str
    provider: Literal["anthropic", "local"]
    available: bool


class UnknownModelError(ValueError):
    """The requested model is not one this Jarvis may use."""


class ModelCatalog:
    """Lists the models and resolves a requested one to the one that will answer.

    Args:
        settings: Gateway URL, key, default and fallback models, Ollama URL.
        transport: Replace the HTTP transport. Used by tests.
        clock: Replace the monotonic clock. Used by tests to expire caches.
    """

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._settings = settings
        self._http = httpx.AsyncClient(transport=transport, timeout=PROBE_TIMEOUT)
        self._clock = clock
        self._ids: list[str] = []
        self._ids_at = float("-inf")
        self._gpu_up = False
        self._gpu_at = float("-inf")

    @property
    def default(self) -> str:
        return self._settings.model

    async def entries(self) -> list[ModelInfo]:
        """Every model this Jarvis may use, local ones flagged by availability."""
        ids = await self._ids_cached()
        gpu = await self.gpu_available() if any(not is_native(i) for i in ids) else False
        return [
            ModelInfo(id=i, provider="anthropic" if is_native(i) else "local", available=is_native(i) or gpu)
            for i in ids
        ]

    async def resolve(self, requested: str | None) -> str:
        """Return the model a run should use for ``requested``.

        Raises:
            UnknownModelError: ``requested`` is not in the catalog.
        """
        if not requested:
            return self.default
        if requested not in await self._ids_cached():
            raise UnknownModelError(f"unknown model: {requested}")
        if not is_native(requested) and not await self.gpu_available():
            fallback = self._settings.local_fallback_model
            logger.info("model.local_offline", requested=requested, fallback=fallback)
            return fallback
        return requested

    async def gpu_available(self) -> bool:
        """Whether Ollama answers. Unknown (no ``ollama_url``) counts as available:
        the gateway's own fallback still covers it."""
        if not self._settings.ollama_url:
            return True
        if self._clock() - self._gpu_at < PROBE_TTL:
            return self._gpu_up
        try:
            response = await self._http.get(f"{self._settings.ollama_url.rstrip('/')}/api/tags")
            self._gpu_up = response.status_code == 200
        except httpx.HTTPError:
            self._gpu_up = False
        self._gpu_at = self._clock()
        return self._gpu_up

    async def _ids_cached(self) -> list[str]:
        if self._clock() - self._ids_at < MODELS_TTL:
            return self._ids
        self._ids = await self._fetch_ids()
        self._ids_at = self._clock()
        return self._ids

    async def _fetch_ids(self) -> list[str]:
        """Ask the gateway; on failure keep the last good list, or the default alone."""
        gateway, key = self._settings.llm_gateway_url, self._settings.anthropic_api_key
        if not gateway or key is None:
            return [self.default]
        try:
            response = await self._http.get(
                f"{gateway.rstrip('/')}/v1/models",
                headers={"Authorization": f"Bearer {key.get_secret_value()}"},
                timeout=5.0,
            )
            response.raise_for_status()
            ids = [str(m["id"]) for m in response.json().get("data", [])]
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            logger.warning("models.unavailable", error=str(exc))
            return self._ids or [self.default]
        # Claude first, then local, each alphabetical: the order the picker shows.
        return sorted(ids, key=lambda i: (not is_native(i), i))

    async def aclose(self) -> None:
        await self._http.aclose()


__all__ = ["ModelCatalog", "ModelInfo", "UnknownModelError"]
