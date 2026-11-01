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
