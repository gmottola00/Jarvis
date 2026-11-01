"""Log lines: telling probes apart, and re-cutting the kubelet's chunks."""

from __future__ import annotations

from typing import AsyncIterator

import pytest

from jarvis.tools.k8s.client import split_lines
from jarvis.tools.k8s.logfilter import is_probe


@pytest.mark.parametrize(
    "line",
    [
        'INFO:     10.42.0.31:54122 - "GET /health HTTP/1.1" 200 OK',
        'INFO:     10.42.0.31:54122 - "GET /healthz HTTP/1.1" 200 OK',
        'INFO:     10.42.0.9:4122 - "GET /health/readiness HTTP/1.1" 200 OK',
        'INFO:     10.42.0.9:4122 - "GET /health/liveliness HTTP/1.1" 200 OK',
        '10.42.0.1 - - [01/Nov/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 615 "-" "kube-probe/1.31"',
    ],
)
def test_probe_lines_are_recognised(line: str) -> None:
    assert is_probe(line)


@pytest.mark.parametrize(
    "line",
    [
        'INFO:     10.42.0.31:54130 - "GET /api/leagues HTTP/1.1" 200 OK',
        'INFO:     10.42.0.31:54130 - "GET /api/health-report HTTP/1.1" 200 OK',
        # A failing health check is news, not noise.
        'INFO:     10.42.0.31:54122 - "GET /health HTTP/1.1" 503 Service Unavailable',
        "WARNING:  health of the scheduler degraded",
    ],
)
def test_real_traffic_is_kept(line: str) -> None:
    assert not is_probe(line)


async def _chunks(*parts: bytes) -> AsyncIterator[bytes]:
    for part in parts:
        yield part


async def test_chunks_are_recut_on_newlines() -> None:
    caffe = "caffè".encode()
    stream = _chunks(b"one\ntw", b"o\nthree\n\nfo", caffe[:4], caffe[4:] + b"\r\n", b"tail")
    assert [line async for line in split_lines(stream)] == ["one", "two", "three", "focaffè", "tail"]


@pytest.mark.parametrize(
    ("owner", "workload"),
    [
        ("ReplicaSet/tickup-web-8c9d7f6b5", "tickup-web"),
        ("StatefulSet/argocd-application-controller", "argocd-application-controller"),
        ("Job/backup-29123", ""),
        ("", ""),
    ],
)
def test_workload_from_owner_reference(owner: str, workload: str) -> None:
    from jarvis.api.routers.status import _workload_of
    from jarvis.core.console import PodDetail

    assert _workload_of(PodDetail(namespace="ns", name="p", phase="Running", owner=owner)) == workload


async def _forever(tag: str) -> AsyncIterator[str]:
    index = 0
    while True:
        yield f"{tag}{index}"
        index += 1


async def test_merge_interleaves_and_tags() -> None:
    from jarvis.api.fetch import merge

    merged = merge({"a": _chunks_text("a1", "a2"), "b": _chunks_text("b1")})
    items = [item async for item in merged]
    assert sorted(items) == [("a", "a1"), ("a", "a2"), ("b", "b1")]


async def _chunks_text(*items: str) -> AsyncIterator[str]:
    for item in items:
        yield item


async def test_merge_survives_one_failing_stream() -> None:
    from jarvis.api.fetch import merge

    async def broken() -> AsyncIterator[str]:
        yield "x"
        raise RuntimeError("pod went away")

    items = [item async for item in merge({"ok": _chunks_text("y"), "bad": broken()})]
    assert ("ok", "y") in items and ("bad", "x") in items
    assert any(key == "bad" and isinstance(value, RuntimeError) for key, value in items)


async def test_closing_merge_with_a_full_buffer_does_not_hang() -> None:
    """The browser leaving mid-stream: readers are blocked on a full queue and must still stop."""
    import asyncio

    from jarvis.api.fetch import merge

    merged = merge({"a": _forever("a"), "b": _forever("b")}, buffer=2)
    first = await anext(merged)
    assert first[0] in {"a", "b"}
    await asyncio.sleep(0.01)  # let both readers fill the buffer and block on it
    await asyncio.wait_for(merged.aclose(), timeout=1)


def test_merged_percentiles_are_request_weighted() -> None:
    from jarvis.api.routers.gateway import merge_models
    from jarvis.core.console import UsageRow

    rows = [
        UsageRow(alias="a", model="m", requests=3, failures=1, spend=0.3, p50_ms=100),
        UsageRow(alias="b", model="m", requests=1, failures=0, spend=0.1, p50_ms=500, ttft_p50_ms=50),
    ]
    [model] = merge_models(rows)
    assert model.requests == 4 and model.failures == 1 and model.spend == pytest.approx(0.4)
    assert model.p50_ms == pytest.approx(200)
    assert model.ttft_p50_ms == pytest.approx(50)
    assert model.p95_ms is None
