"""The LiteLLM gateway as the console sees it: spend, failures and latency per app and model."""

from __future__ import annotations

from quaerium.agents import ClientProvider

from jarvis.gateway.client import GatewayUsageClient
from jarvis.gateway.fake import FakeGatewayUsageClient
from jarvis.settings import Settings, get_settings
from jarvis.tools.fakes import FAKE_HINT, use_fake

provider: ClientProvider[Settings, GatewayUsageClient | FakeGatewayUsageClient] = ClientProvider(
    name="litellm",
    settings=get_settings,
    real=GatewayUsageClient,
    fake=FakeGatewayUsageClient,
    use_fake=use_fake,
    requires=lambda s: [] if s.litellm_db_url else ["JARVIS_LITELLM_DB_URL"],
    hint=FAKE_HINT,
)

__all__ = ["FakeGatewayUsageClient", "GatewayUsageClient", "provider"]
