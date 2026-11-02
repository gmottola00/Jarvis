"""Application settings.

One ``Settings`` object, loaded once, injected everywhere. Nothing in Jarvis reads
``os.environ`` directly: import-time ``os.getenv`` defaults would freeze before
``.env`` is loaded, which is a trap worth avoiding.

Every credential lives here and nowhere else. Tool clients read their token from
``Settings``; tokens never enter agent state, prompts, or the event stream.

Example:
    >>> from jarvis.settings import get_settings
    >>> settings = get_settings()
    >>> settings.model
    'claude-opus-5'
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from the environment and ``.env``.

    All fields take the ``JARVIS_`` prefix except the provider keys, which keep
    their conventional unprefixed names so an existing shell export just works.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="JARVIS_",
        extra="ignore",
        populate_by_name=True,
    )

    # --- Model ---------------------------------------------------------------
    anthropic_api_key: SecretStr | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    """The real Anthropic key, or the gateway's virtual key when ``llm_gateway_url`` is set."""

    model: str = "claude-opus-5"
    """Default model; the dashboard can pick another per message."""

    router_model: str = "claude-haiku-4-5"
    max_tokens: int = 64000
    effort: Literal["low", "medium", "high", "xhigh", "max"] = "high"

    llm_gateway_url: str | None = None
    """LiteLLM proxy base URL. Unset means Claude only, straight to Anthropic."""

    ollama_url: str | None = None
    """Ollama behind the gateway, probed only to tell whether the GPU machine is on."""

    local_fallback_model: str = "claude-haiku-4-5"
    """Answers instead of a local model while the GPU machine is off."""

    # --- Behaviour -----------------------------------------------------------
    fake_tools: bool = False
    """Serve every capability from its ``fake`` module: no credentials, no network."""

    max_graph_steps: int = 12
    """Hard ceiling on model<->tool round trips in a single run."""

    # --- Backing stores ------------------------------------------------------
    database_url: str | None = None
    """Postgres DSN for the LangGraph checkpointer and the audit tables.

    Unset means in-process memory: the graph still works and still interrupts,
    but a restart forgets pending approvals.
    """

    redis_url: str | None = None
    """Redis URL for session turns. Unset means an in-process dict."""

    litellm_db_url: SecretStr | None = None
    """DSN of LiteLLM's Postgres as ``jarvis_reader``, for the gateway view.

    That role can only call the ``jarvis_ro.*`` functions (aggregates, no prompts,
    no keys); see ``apps/litellm/jarvis-reader.sql`` in Home-Lab-Infra. Unset
    hides the gateway panels.
    """

    session_ttl_seconds: int = 86_400

    # --- Capabilities: GitHub ------------------------------------------------
    github_token: SecretStr | None = None
    github_owner: str = "gmottola00"
    github_infra_repo: str = "Home-Lab-Infra"
    github_api_url: str = "https://api.github.com"

    replicas_apps: list[str] = ["tickup", "trip-ai"]
    """Apps whose replica count ``github__set_replicas`` may change, through a pull request.

    Everything else — the platform, LiteLLM, Jarvis itself — is off limits, so a
    model cannot propose switching off the things the lab needs to recover.
    """

    # --- Capabilities: ArgoCD ------------------------------------------------
    argocd_base_url: str | None = None
    argocd_token: SecretStr | None = None
    argocd_verify_tls: bool = True

    # --- Capabilities: Kubernetes -------------------------------------------
    kubeconfig: str | None = None
    """Path to a kubeconfig. Unset falls back to in-cluster config, then to fakes."""

    # --- Capabilities: observability ----------------------------------------
    prometheus_url: str | None = None
    """kube-prometheus-stack's Prometheus, e.g. ``http://kube-prometheus-stack-prometheus.monitoring:9090``."""

    loki_url: str | None = None
    """Loki's HTTP API, e.g. ``http://loki.monitoring:3100``."""

    alertmanager_url: str | None = None
    """Alertmanager's API, e.g. ``http://kube-prometheus-stack-alertmanager.monitoring:9093``."""

    # --- Notifications -------------------------------------------------------
    notify_url: str | None = None
    """notify-hub base URL. Unset means push notifications are off."""

    notify_token: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("JARVIS_NOTIFY_TOKEN", "NOTIFY_TOKEN")
    )
    """Jarvis's bearer token for notify-hub. Also read from plain ``NOTIFY_TOKEN``,
    the key ``make notify-token`` writes into the ``jarvis-notify`` secret."""

    # --- API -----------------------------------------------------------------
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:8080"]
    log_level: str = "INFO"
    log_json: bool = False

    @property
    def has_anthropic(self) -> bool:
        """Whether a model call can be made at all. An empty key counts as none."""
        return self.anthropic_api_key is not None and bool(self.anthropic_api_key.get_secret_value().strip())


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings, constructed once.

    Cached so that every module sees the same object; call ``get_settings.cache_clear()``
    in tests that need to re-read the environment.
    """
    return Settings()


__all__ = ["Settings", "get_settings"]
