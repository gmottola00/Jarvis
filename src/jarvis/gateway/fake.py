"""Fixtures for the gateway view, shaped like the real ``jarvis_ro`` answers."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from jarvis.core.console import DailySpend, GatewayError, KeyUsage, UsageRow


def _now() -> datetime:
    return datetime.now(timezone.utc)


_KEYS = [
    ("jarvis", 0.41, 20.0),
    ("alfred", 8.6, 10.0),
    ("trip-ai", 0.0, 20.0),
    ("interview", 0.0, 5.0),
    ("jarvis-dev", 0.0, 5.0),
]


class FakeGatewayUsageClient:
    """Same surface as :class:`GatewayUsageClient`."""

    async def key_budgets(self) -> list[KeyUsage]:
        reset = _now() + timedelta(days=12)
        return [
            KeyUsage(alias=a, spend=s, max_budget=b, budget_duration="30d", budget_reset_at=reset) for a, s, b in _KEYS
        ]

    async def usage(self, since: datetime) -> list[UsageRow]:
        return [
            UsageRow(
                alias="jarvis",
                model="claude-opus-5",
                requests=31,
                failures=1,
                spend=0.32,
                prompt_tokens=182_000,
                completion_tokens=9_400,
                p50_ms=4_200,
                p95_ms=11_800,
                ttft_p50_ms=900,
            ),
            UsageRow(
                alias="alfred",
                model="claude-sonnet-5",
                requests=12,
                failures=0,
                spend=0.06,
                prompt_tokens=40_000,
                completion_tokens=3_100,
                p50_ms=2_100,
                p95_ms=3_900,
                ttft_p50_ms=600,
            ),
            UsageRow(
                alias="jarvis",
                model="local/qwen3-14b",
                requests=7,
                failures=6,
                spend=0.0,
                p50_ms=120_000,
                p95_ms=120_800,
            ),
        ]

    async def recent_errors(self, since: datetime, limit: int = 20) -> list[GatewayError]:
        return [
            GatewayError(
                at=_now() - timedelta(minutes=40),
                alias="jarvis",
                model="local/qwen3-14b",
                error_class="Timeout",
                error_code="408",
                normalized_error="408_UPSTREAM_TIMEOUT",
                message="litellm.Timeout: Ollama_chatException - Connection timed out. Timeout passed=120.0",
            ),
            GatewayError(
                at=_now() - timedelta(hours=3),
                alias="jarvis",
                model="claude-haiku-4-5",
                error_class="HTTPException",
                error_code="400",
                normalized_error="500_UPSTREAM_PASSTHROUGH",
                message='400: Upstream passthrough request failed: "adaptive thinking is not supported on this model"',
            ),
        ][:limit]

    async def daily_spend(self, days: int = 7) -> list[DailySpend]:
        today = date.today()
        return [
            DailySpend(day=today - timedelta(days=offset), alias=alias, spend=spend, requests=req, failures=fail)
            for offset in range(days)
            for alias, spend, req, fail in (("jarvis", 0.05 + 0.01 * offset, 6, offset % 2), ("alfred", 1.1, 4, 0))
        ]

    async def aclose(self) -> None:
        return None
