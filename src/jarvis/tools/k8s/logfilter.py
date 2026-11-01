"""Telling kubelet probes apart from real traffic in a log line.

Every backend in the lab answers a readiness probe every 10s and a liveness
probe every 20s, and uvicorn writes an access line for each: about nine lines a
minute that say nothing. nginx does the same for its ``/`` probe, but tags it
with the ``kube-probe/`` user agent. The console hides both by default.

The pattern is anchored on the request line (``"GET /health… HTTP/1.1" 2xx``)
so an endpoint that merely *contains* "health" — ``/api/health-report`` — is
never mistaken for one. The same expression lives in the Alloy pipeline in
Home-Lab-Infra, so Loki and the console agree on what a probe is.
"""

from __future__ import annotations

import re

PROBE_PATTERN = re.compile(
    r'"GET /(?:health(?:z|/[\w-]+)?|ready(?:z)?|live(?:z|ness)?)(?:\?\S*)? HTTP/1\.[01]" 2\d\d|kube-probe/'
)


def is_probe(line: str) -> bool:
    """True when ``line`` is the access log of a health probe."""
    return PROBE_PATTERN.search(line) is not None


__all__ = ["PROBE_PATTERN", "is_probe"]
