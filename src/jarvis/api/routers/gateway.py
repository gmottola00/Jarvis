"""Gateway: what LiteLLM did for every app — spend against budget, failures, latency.

Read from LiteLLM's own database through functions that return aggregates
only (see ``jarvis.gateway``). Like the other console routers each source is
fetched independently: a function that breaks after a LiteLLM upgrade costs
its own panel, and an unconfigured database is a note, not an error page.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query

from jarvis import gateway
from jarvis.api.fetch import attempt
from jarvis.core.console import GatewayView, KeyUsage, ModelUsage, UsageRow
from jarvis.exceptions import ConfigurationError

router = APIRouter(prefix="/api/gateway", tags=["gateway"])

#: Recent errors returned with the view; LiteLLM's UI has the full log.
MAX_ERRORS = 20
DAILY_DAYS = 7


def merge_models(rows: list[UsageRow]) -> list[ModelUsage]:
    """Fold per-(key, model) rows into per-model totals.

    Counts and spend add up; percentiles do not, so the merged p50/p95 is the
    request-weighted mean of the per-key values — close enough to rank models,
    and exact whenever one key dominates a model, which is the usual case here.
    """
    groups: dict[str, list[UsageRow]] = defaultdict(list)
    for row in rows:
        groups[row.model].append(row)

    def weighted(items: list[UsageRow], field: str) -> float | None:
        pairs = [(getattr(r, field), r.requests) for r in items if getattr(r, field) is not None and r.requests]
        total = sum(n for _, n in pairs)
        return sum(v * n for v, n in pairs) / total if total else None

    merged = [
        ModelUsage(
            model=model,
            requests=sum(r.requests for r in items),
            failures=sum(r.failures for r in items),
            spend=sum(r.spend for r in items),
            prompt_tokens=sum(r.prompt_tokens for r in items),
            completion_tokens=sum(r.completion_tokens for r in items),
            p50_ms=weighted(items, "p50_ms"),
            p95_ms=weighted(items, "p95_ms"),
            ttft_p50_ms=weighted(items, "ttft_p50_ms"),
        )
        for model, items in groups.items()
    ]
    return sorted(merged, key=lambda m: m.requests, reverse=True)


def merge_keys(budgets: list[KeyUsage], rows: list[UsageRow]) -> list[KeyUsage]:
    """Budgets joined with what each key did in the window; keys that only appear in usage are kept."""
    by_alias = {k.alias: k.model_copy() for k in budgets}
    for row in rows:
        key = by_alias.setdefault(row.alias, KeyUsage(alias=row.alias))
        key.window_spend += row.spend
        key.requests += row.requests
        key.failures += row.failures
    return sorted(by_alias.values(), key=lambda k: (k.budget_used or 0, k.window_spend), reverse=True)


@router.get("", response_model=GatewayView)
async def overview(hours: int = Query(24, ge=1, le=24 * 30)) -> GatewayView:
    """Per app, per model and per day, plus the latest failures, over the last ``hours``."""
    try:
        client = gateway.provider.get()
    except ConfigurationError as exc:
        return GatewayView(window_hours=hours, sources={"litellm": str(exc)})

    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    errors: dict[str, str] = {}
    budgets, usage, recent, daily = await asyncio.gather(
        attempt("litellm.key_budgets", client.key_budgets, errors),
        attempt("litellm.usage", lambda: client.usage(since), errors),
        attempt("litellm.recent_errors", lambda: client.recent_errors(since, MAX_ERRORS), errors),
        attempt("litellm.daily_spend", lambda: client.daily_spend(DAILY_DAYS), errors),
    )
    rows = usage or []
    return GatewayView(
        window_hours=hours,
        keys=merge_keys(budgets or [], rows),
        models=merge_models(rows),
        daily=daily or [],
        errors=recent or [],
        sources=errors,
    )
