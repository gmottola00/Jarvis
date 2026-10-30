"""Client resolution for capabilities.

Every capability needs the same three-way decision on first use: serve fakes,
use the real client, or explain what is missing. This puts that decision in one
place so each capability's ``tools.py`` stays about the tools.

Example:
    >>> provider = ClientProvider(                       # doctest: +SKIP
    ...     name="argocd",
    ...     real=lambda s: ArgoCDClient(s),
    ...     fake=lambda: FakeArgoCDClient(),
    ...     requires=lambda s: [] if s.argocd_token else ["JARVIS_ARGOCD_TOKEN"],
    ... )
    >>> client = provider.get()                          # doctest: +SKIP
"""

from __future__ import annotations

from typing import Any, Callable, Generic, TypeVar

from jarvis.exceptions import ConfigurationError
from jarvis.logging import get_logger
from jarvis.settings import Settings, get_settings

logger = get_logger(__name__)

T = TypeVar("T")


class ClientProvider(Generic[T]):
    """Lazily builds and caches one capability's client.

    Args:
        name: Capability name, used in log lines and error messages.
        real: Builds the live client from settings.
        fake: Builds the offline stand-in.
        requires: Returns the names of settings that are missing. A non-empty
            result means the live client cannot be built.
    """

    def __init__(
        self,
        *,
        name: str,
        real: Callable[[Settings], T],
        fake: Callable[[], T],
        requires: Callable[[Settings], list[str]],
    ) -> None:
        self._name = name
        self._real = real
        self._fake = fake
        self._requires = requires
        self._cached: T | None = None

    def get(self) -> T:
        """Return the client, building it on first use.

        Raises:
            ConfigurationError: Live mode was requested but credentials are missing.
                The message names the exact environment variables to set.
        """
        if self._cached is not None:
            return self._cached

        settings = get_settings()
        if settings.fake_tools:
            logger.info("capability.fake", capability=self._name)
            self._cached = self._fake()
            return self._cached

        missing = self._requires(settings)
        if missing:
            raise ConfigurationError(
                f"{self._name} is not configured: set {', '.join(missing)} "
                f"(or JARVIS_FAKE_TOOLS=true to run against fixtures)"
            )

        logger.info("capability.live", capability=self._name)
        self._cached = self._real(settings)
        return self._cached

    @property
    def name(self) -> str:
        """The capability this provider serves, e.g. ``github``."""
        return self._name

    def missing(self) -> list[str]:
        """The settings the live client still needs. Empty when it can be built."""
        return self._requires(get_settings())

    def reset(self) -> None:
        """Drop the cached client. Used by tests and by settings reloads."""
        closer = getattr(self._cached, "close", None)
        if closer is not None:
            try:
                result = closer()
                if hasattr(result, "__await__"):  # pragma: no cover - best effort
                    result.close()
            except Exception:  # noqa: BLE001 - teardown must not raise
                pass
        self._cached = None

    async def aclose(self) -> None:
        """Close the cached client, if it has an async ``aclose``."""
        client: Any = self._cached
        if client is not None and hasattr(client, "aclose"):
            try:
                await client.aclose()
            except Exception:  # noqa: BLE001 - teardown must not raise
                logger.warning("capability.close_failed", capability=self._name)
        self._cached = None


__all__ = ["ClientProvider"]
