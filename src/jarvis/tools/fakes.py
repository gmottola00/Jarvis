"""When capabilities serve their fixtures instead of the real service.

One switch for all of them, ``JARVIS_FAKE_TOOLS``: every
:class:`~quaerium.agents.ClientProvider` in Jarvis passes :func:`use_fake` and
:data:`FAKE_HINT`, so the rule and the error message stay in one place.
"""

from __future__ import annotations

from jarvis.settings import Settings

FAKE_HINT = "or JARVIS_FAKE_TOOLS=true to run against fixtures"
"""Appended to every "not configured" error."""


def use_fake(settings: Settings) -> bool:
    """Whether to serve the fake: ``JARVIS_FAKE_TOOLS=true``."""
    return settings.fake_tools


__all__ = ["FAKE_HINT", "use_fake"]
