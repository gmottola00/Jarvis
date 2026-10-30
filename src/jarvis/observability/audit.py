"""Audit log.

The record that answers "why did it do that": for each run, the prompt, every
tool call with its arguments and outcome, every approval and how it was decided,
and the final answer.

Always kept in memory so ``/api/runs`` works with no database at all; also
written to Postgres when one is configured, because the interesting question is
usually about a run from last week.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque

from jarvis.core.types import Approval, ToolCall, ToolResult, Usage
from jarvis.logging import get_logger
from jarvis.settings import Settings

logger = get_logger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS jarvis_runs (
    run_id       TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    prompt       TEXT NOT NULL,
    answer       TEXT,
    usage        JSONB,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS jarvis_tool_calls (
    id           BIGSERIAL PRIMARY KEY,
    run_id       TEXT NOT NULL REFERENCES jarvis_runs(run_id) ON DELETE CASCADE,
    tool         TEXT NOT NULL,
    risk         TEXT NOT NULL,
    args         JSONB NOT NULL,
    ok           BOOLEAN NOT NULL,
    output       TEXT,
    duration_ms  DOUBLE PRECISION,
    at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jarvis_approvals (
    id           BIGSERIAL PRIMARY KEY,
    run_id       TEXT NOT NULL REFERENCES jarvis_runs(run_id) ON DELETE CASCADE,
    tool         TEXT NOT NULL,
    args         JSONB NOT NULL,
    why          TEXT NOT NULL,
    approved     BOOLEAN NOT NULL,
    decided_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jarvis_runs_session_idx ON jarvis_runs(session_id, started_at DESC);
ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE jarvis_runs ADD COLUMN IF NOT EXISTS served_by TEXT;
"""

RISKS = ("read", "write", "destructive")


class AuditLog:
    """Records runs. In-memory always; Postgres additionally, when available.

    Args:
        capacity: How many recent runs to keep in memory.
        pool: An open ``psycopg_pool.AsyncConnectionPool``, or None.
    """

    def __init__(self, *, capacity: int = 200, pool: Any = None) -> None:
        self._runs: Deque[dict[str, Any]] = deque(maxlen=capacity)
        self._index: dict[str, dict[str, Any]] = {}
        self._pool = pool

    # --- recording ----------------------------------------------------------

    async def start_run(self, run_id: str, session_id: str, prompt: str, model: str = "") -> None:
        """Open a run. ``model`` is the one the user picked, before any fallback."""
        record: dict[str, Any] = {
            "run_id": run_id,
            "session_id": session_id,
            "prompt": prompt,
            "model": model,
            "served_by": "",
            "pending": None,
            "answer": "",
            "usage": Usage().model_dump(),
            "tool_calls": [],
            "approvals": [],
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
        }
        if len(self._runs) == self._runs.maxlen and self._runs:
            self._index.pop(self._runs[0]["run_id"], None)
        self._runs.append(record)
        self._index[run_id] = record
        await self._write(
            "INSERT INTO jarvis_runs (run_id, session_id, prompt, model) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
            (run_id, session_id, prompt, model),
        )

    async def record_tool_call(self, run_id: str, call: ToolCall, result: ToolResult) -> None:
        entry = {
            "tool": call.name,
            "risk": call.risk.value,
            "args": call.args,
            "ok": result.ok,
            "summary": result.summary,
            "duration_ms": round(result.duration_ms, 1),
            "at": datetime.now(timezone.utc).isoformat(),
        }
        if run_id in self._index:
            self._index[run_id]["tool_calls"].append(entry)
        await self._write(
            "INSERT INTO jarvis_tool_calls (run_id, tool, risk, args, ok, output, duration_ms)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (
                run_id,
                call.name,
                call.risk.value,
                self._json(call.args),
                result.ok,
                result.content[:8000],
                result.duration_ms,
            ),
        )

    async def record_approval(self, run_id: str, approval: Approval) -> None:
        entry = {
            "tool": approval.tool_call.name,
            "args": approval.tool_call.args,
            "why": approval.why,
            "approved": bool(approval.approved),
            "decided_at": (approval.decided_at or datetime.now(timezone.utc)).isoformat(),
        }
        if run_id in self._index:
            self._index[run_id]["approvals"].append(entry)
            self._index[run_id]["pending"] = None
        logger.info("audit.approval", tool=entry["tool"], approved=entry["approved"])
        await self._write(
            "INSERT INTO jarvis_approvals (run_id, tool, args, why, approved) VALUES (%s, %s, %s, %s, %s)",
            (
                run_id,
                approval.tool_call.name,
                self._json(approval.tool_call.args),
                approval.why,
                bool(approval.approved),
            ),
        )

    def suspend_run(self, run_id: str, tool: str, args: dict[str, Any], why: str) -> None:
        """Mark a run as waiting at the gate. The next :meth:`record_approval` clears it.

        In memory only: the checkpointer is what keeps the run itself, this is
        just what lets ``/api/approvals`` list every waiting run at once.
        """
        if run_id in self._index:
            self._index[run_id]["pending"] = {
                "tool": tool,
                "args": args,
                "why": why,
                "since": datetime.now(timezone.utc).isoformat(),
            }

    async def finish_run(self, run_id: str, answer: str, usage: Usage, served_by: str = "") -> None:
        """Close a run. ``served_by`` is the model that actually answered."""
        if run_id in self._index:
            self._index[run_id]["answer"] = answer
            self._index[run_id]["served_by"] = served_by
            self._index[run_id]["usage"] = usage.model_dump()
            self._index[run_id]["finished_at"] = datetime.now(timezone.utc).isoformat()
        await self._write(
            "UPDATE jarvis_runs SET answer = %s, usage = %s, served_by = %s, finished_at = now() WHERE run_id = %s",
            (answer, self._json(usage.model_dump()), served_by, run_id),
        )

    # --- reading ------------------------------------------------------------

    def recent(self, *, limit: int = 50, session_id: str | None = None) -> list[dict[str, Any]]:
        """Return recent runs, newest first, with their tool calls counted by risk."""
        runs = [r for r in reversed(self._runs) if session_id is None or r["session_id"] == session_id]
        return [self._summary(r) for r in runs[:limit]]

    @staticmethod
    def _summary(run: dict[str, Any]) -> dict[str, Any]:
        """A run without its tool calls. ``risk`` is the highest one it reached, the waiting call included."""
        by_risk = {risk: sum(1 for c in run["tool_calls"] if c["risk"] == risk) for risk in RISKS}
        reached = [risk for risk in RISKS if by_risk[risk]] + (["destructive"] if run["pending"] else [])
        return {k: v for k, v in run.items() if k != "tool_calls"} | {
            "tool_count": len(run["tool_calls"]),
            "calls_by_risk": by_risk,
            "risk": max(reached, key=RISKS.index) if reached else None,
        }

    def pending(self) -> list[dict[str, Any]]:
        """Every run waiting at the gate, oldest first: the order they should be decided in."""
        return [
            {"run_id": r["run_id"], "session_id": r["session_id"], "prompt": r["prompt"]} | r["pending"]
            for r in self._runs
            if r["pending"]
        ]

    def decisions(self, *, limit: int = 20) -> list[dict[str, Any]]:
        """Settled approvals across all runs, newest first."""
        settled = [{"run_id": r["run_id"], "prompt": r["prompt"]} | a for r in self._runs for a in r["approvals"]]
        return sorted(settled, key=lambda a: a["decided_at"], reverse=True)[:limit]

    def get(self, run_id: str) -> dict[str, Any] | None:
        """Return one run in full, tool calls and approvals included."""
        return self._index.get(run_id)

    # --- persistence --------------------------------------------------------

    @staticmethod
    def _json(value: Any) -> Any:
        """Adapt a dict for a JSONB column."""
        try:
            from psycopg.types.json import Jsonb

            return Jsonb(value)
        except ImportError:  # pragma: no cover - optional dependency
            return value

    async def _write(self, sql: str, params: tuple[Any, ...]) -> None:
        """Best-effort persistence. Losing an audit row must not fail a run."""
        if self._pool is None:
            return
        try:
            async with self._pool.connection() as conn:
                await conn.execute(sql, params)
        except Exception as exc:  # noqa: BLE001 - audit is not on the critical path
            logger.warning("audit.write_failed", error=str(exc))


async def build_audit_log(settings: Settings) -> tuple[AuditLog, Any]:
    """Build the audit log and, when configured, the pool backing it.

    Returns:
        The log and the connection pool to close on shutdown (None without Postgres).
    """
    if not settings.database_url:
        logger.warning("audit.in_memory", reason="JARVIS_DATABASE_URL is not set")
        return AuditLog(), None

    try:
        from psycopg_pool import AsyncConnectionPool
    except ImportError:  # pragma: no cover - optional dependency
        logger.error("audit.psycopg_missing", hint="pip install 'jarvis[postgres]'")
        return AuditLog(), None

    pool = AsyncConnectionPool(settings.database_url, min_size=1, max_size=4, open=False)
    await pool.open(wait=True, timeout=15)
    async with pool.connection() as conn:
        await conn.execute(SCHEMA)
    logger.info("audit.postgres")
    return AuditLog(pool=pool), pool


__all__ = ["SCHEMA", "AuditLog", "build_audit_log"]
