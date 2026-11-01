"""The LiteLLM gateway as the console sees it: spend, failures and latency per app and model."""

from __future__ import annotations

from jarvis.gateway.client import GatewayUsageClient
from jarvis.gateway.fake import FakeGatewayUsageClient
from jarvis.tools.provider import ClientProvider

provider: ClientProvider[GatewayUsageClient | FakeGatewayUsageClient] = ClientProvider(
    name="litellm",
    real=GatewayUsageClient,
    fake=FakeGatewayUsageClient,
    requires=lambda s: [] if s.litellm_db_url else ["JARVIS_LITELLM_DB_URL"],
)

__all__ = ["FakeGatewayUsageClient", "GatewayUsageClient", "provider"]
