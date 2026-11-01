"""LiteLLM usage, read from its Postgres through the ``jarvis_ro`` functions.

The role this connects as (``jarvis_reader``) cannot read any LiteLLM table:
it can only call four ``SECURITY DEFINER`` functions that return aggregates —
no prompts, no key hashes, no tracebacks. The SQL lives with the database, in
Home-Lab-Infra (``apps/litellm/jarvis-reader.sql``).

This is console plumbing, not an agent capability: no tool wraps it, so the
model never sees spend or error data unless a person pastes it into a chat.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from jarvis.core.console import DailySpend, GatewayError, KeyUsage, UsageRow
from jarvis.exceptions import ConfigurationError, UpstreamError
from jarvis.settings import Settings


class GatewayUsageClient:
    """Calls the ``jarvis_ro`` functions over a tiny, lazily opened pool."""

    def __init__(self, settings: Settings) -> None:
        if settings.litellm_db_url is None:
            raise ConfigurationError("litellm usage is not configured: set JARVIS_LITELLM_DB_URL")
        self._dsn = settings.litellm_db_url.get_secret_value()
        self._pool: Any = None

    async def _rows(self, query: str, *args: Any) -> list[dict[str, Any]]:
        from psycopg.rows import dict_row
        from psycopg_pool import AsyncConnectionPool

        try:
            if self._pool is None:
                self._pool = AsyncConnectionPool(
                    self._dsn,
                    min_size=0,
                    max_size=2,
                    open=False,
                    kwargs={"options": "-c default_transaction_read_only=on -c statement_timeout=5000"},
                )
                await self._pool.open(wait=False)
            async with self._pool.connection(timeout=5) as conn:
                cursor = await conn.cursor(row_factory=dict_row).execute(query, args)
                return list(await cursor.fetchall())
        except Exception as exc:
            raise UpstreamError("litellm", f"{type(exc).__name__}: {exc}") from exc

    async def key_budgets(self) -> list[KeyUsage]:
        return [KeyUsage(**row) for row in await self._rows("SELECT * FROM jarvis_ro.key_budgets()")]

    async def usage(self, since: datetime) -> list[UsageRow]:
        return [UsageRow(**row) for row in await self._rows("SELECT * FROM jarvis_ro.usage(%s)", since)]

    async def recent_errors(self, since: datetime, limit: int = 20) -> list[GatewayError]:
        rows = await self._rows("SELECT * FROM jarvis_ro.recent_errors(%s, %s)", since, limit)
        # Text columns come back NULL for errors LiteLLM did not classify.
        return [GatewayError.model_validate({k: v if k == "at" else (v or "") for k, v in row.items()}) for row in rows]

    async def daily_spend(self, days: int = 7) -> list[DailySpend]:
        return [DailySpend(**row) for row in await self._rows("SELECT * FROM jarvis_ro.daily_spend(%s)", days)]

    async def aclose(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
