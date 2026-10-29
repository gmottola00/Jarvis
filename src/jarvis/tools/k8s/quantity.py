"""Kubernetes quantity parsing.

The API expresses every number as a string with a suffix, and the suffixes are
not the ones you would guess: ``Mi`` is 2^20 and ``M`` is 10^6, CPU is counted in
cores but written in thousandths, and both forms appear in the same object. A
pod requesting ``100m`` of ``cpu: "4"`` is asking for 2.5% of that node.

Isolated here, with a test, because getting it subtly wrong produces a dashboard
that is confidently off by 4.8%.

Example:
    >>> parse_cpu("100m"), parse_cpu("1.5"), parse_cpu("2")
    (100, 1500, 2000)
    >>> parse_memory("128Mi") == 128 * 1024 ** 2
    True
    >>> format_memory(1610612736)
    '1.5Gi'
"""

from __future__ import annotations

_BINARY = {"Ki": 1024, "Mi": 1024**2, "Gi": 1024**3, "Ti": 1024**4, "Pi": 1024**5, "Ei": 1024**6}
_DECIMAL = {"n": 1e-9, "u": 1e-6, "m": 1e-3, "k": 1e3, "M": 1e6, "G": 1e9, "T": 1e12, "P": 1e15, "E": 1e18}


def parse_cpu(value: str | int | float | None) -> int:
    """Return CPU in millicores.

    Accepts ``"100m"``, ``"1.5"``, ``2`` and the ``"1500n"`` form that
    metrics-server reports.
    """
    if value is None or value == "":
        return 0
    if isinstance(value, (int, float)):
        return int(value * 1000)

    text = value.strip()
    try:
        if text.endswith("m"):
            return int(float(text[:-1]))
        if text.endswith("n"):
            return int(float(text[:-1]) / 1_000_000)
        if text.endswith("u"):
            return int(float(text[:-1]) / 1_000)
        return int(float(text) * 1000)
    except ValueError:
        return 0


def parse_memory(value: str | int | float | None) -> int:
    """Return a memory quantity in bytes.

    Accepts the binary suffixes (``Ki``, ``Mi``, ``Gi``…), the decimal ones
    (``k``, ``M``, ``G``…) and a bare byte count.
    """
    if value is None or value == "":
        return 0
    if isinstance(value, (int, float)):
        return int(value)

    text = value.strip()
    for suffix, factor in _BINARY.items():
        if text.endswith(suffix):
            try:
                return int(float(text[: -len(suffix)]) * factor)
            except ValueError:
                return 0
    for suffix, factor in _DECIMAL.items():
        if text.endswith(suffix):
            try:
                return int(float(text[: -len(suffix)]) * factor)
            except ValueError:
                return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


def format_cpu(milli: int) -> str:
    """Render millicores the way ``kubectl`` would: ``250m``, ``1.5``, ``4``."""
    if milli < 1000:
        return f"{milli}m"
    cores = milli / 1000
    return f"{cores:.0f}" if cores.is_integer() else f"{cores:.1f}"


def format_memory(byte_count: int) -> str:
    """Render bytes with the largest binary suffix that keeps it above 1."""
    if byte_count <= 0:
        return "0"
    for suffix, factor in (("Gi", 1024**3), ("Mi", 1024**2), ("Ki", 1024)):
        if byte_count >= factor:
            scaled = byte_count / factor
            return f"{scaled:.0f}{suffix}" if scaled >= 10 or scaled.is_integer() else f"{scaled:.1f}{suffix}"
    return str(byte_count)


def qos_class(requests: list[dict[str, str]], limits: list[dict[str, str]]) -> str:
    """Derive a pod's QoS class from its containers' requests and limits.

    The rule Kubernetes applies, and the reason it matters: ``BestEffort`` pods
    are evicted first when a node runs out of memory, ``Guaranteed`` last.

    Args:
        requests: One dict per container.
        limits: One dict per container, in the same order.
    """
    if not requests and not limits:
        return "BestEffort"

    parse = {"cpu": parse_cpu, "memory": parse_memory}
    specified = False
    guaranteed = True

    for request, limit in zip(requests, limits):
        for key in ("cpu", "memory"):
            req, lim = request.get(key), limit.get(key)
            if req or lim:
                specified = True
            # Guaranteed needs a limit on both resources in every container, and
            # a request that either matches it or was defaulted from it.
            if not lim or (req and parse[key](req) != parse[key](lim)):
                guaranteed = False

    if not specified:
        return "BestEffort"
    return "Guaranteed" if guaranteed else "Burstable"


__all__ = ["format_cpu", "format_memory", "parse_cpu", "parse_memory", "qos_class"]
