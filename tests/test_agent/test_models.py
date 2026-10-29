"""The model catalog: what the gateway offers, and what answers when the GPU is off."""

from __future__ import annotations

import httpx
import pytest

from jarvis.agent.models import MODELS_TTL, PROBE_TTL, ModelCatalog, UnknownModelError
from jarvis.settings import Settings

GATEWAY = "http://litellm:4000"
OLLAMA = "http://ollama:11434"


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class Lab:
    """A gateway and an Ollama, as one MockTransport handler."""

    def __init__(self) -> None:
        self.models = ["local/qwen3-30b", "claude-opus-5", "claude-haiku-4-5"]
        self.gpu_on = True
        self.gateway_up = True
        self.calls: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request.url.path)
        if request.url.host == "litellm":
            if not self.gateway_up:
                raise httpx.ConnectError("down")
            assert request.headers["authorization"] == "Bearer sk-virtual"
            return httpx.Response(200, json={"data": [{"id": m} for m in self.models]})
        if not self.gpu_on:
            raise httpx.ConnectTimeout("no route")
        return httpx.Response(200, json={"models": []})


@pytest.fixture
def lab() -> Lab:
    return Lab()


@pytest.fixture
def clock() -> Clock:
    return Clock()


def catalog(lab: Lab, clock: Clock) -> ModelCatalog:
    settings = Settings(ANTHROPIC_API_KEY="sk-virtual", llm_gateway_url=GATEWAY, ollama_url=OLLAMA)
    return ModelCatalog(settings, transport=httpx.MockTransport(lab), clock=clock)


class TestEntries:
    async def test_claude_first_then_local_with_gpu_state(self, lab: Lab, clock: Clock) -> None:
        entries = await catalog(lab, clock).entries()

        assert [(m.id, m.provider, m.available) for m in entries] == [
            ("claude-haiku-4-5", "anthropic", True),
            ("claude-opus-5", "anthropic", True),
            ("local/qwen3-30b", "local", True),
        ]

    async def test_gpu_off_marks_only_local_models_unavailable(self, lab: Lab, clock: Clock) -> None:
        lab.gpu_on = False
        entries = await catalog(lab, clock).entries()

        assert {m.id: m.available for m in entries} == {
            "claude-haiku-4-5": True,
            "claude-opus-5": True,
            "local/qwen3-30b": False,
        }

    async def test_without_a_gateway_only_the_default_exists(self, lab: Lab, clock: Clock) -> None:
        models = ModelCatalog(Settings(ANTHROPIC_API_KEY="sk-real", llm_gateway_url=None), clock=clock)
        assert [m.id for m in await models.entries()] == ["claude-opus-5"]

    async def test_a_gateway_outage_keeps_the_last_good_list(self, lab: Lab, clock: Clock) -> None:
        models = catalog(lab, clock)
        await models.entries()

        lab.gateway_up = False
        clock.now += MODELS_TTL + 1

        assert len(await models.entries()) == 3


class TestResolve:
    async def test_empty_means_the_default(self, lab: Lab, clock: Clock) -> None:
        assert await catalog(lab, clock).resolve("") == "claude-opus-5"

    async def test_unknown_models_are_refused(self, lab: Lab, clock: Clock) -> None:
        with pytest.raises(UnknownModelError):
            await catalog(lab, clock).resolve("gpt-5")

    async def test_a_local_model_is_used_while_the_gpu_is_on(self, lab: Lab, clock: Clock) -> None:
        assert await catalog(lab, clock).resolve("local/qwen3-30b") == "local/qwen3-30b"

    async def test_gpu_off_goes_straight_to_the_fallback(self, lab: Lab, clock: Clock) -> None:
        lab.gpu_on = False
        assert await catalog(lab, clock).resolve("local/qwen3-30b") == "claude-haiku-4-5"

    async def test_the_probe_is_cached_then_repeated(self, lab: Lab, clock: Clock) -> None:
        models = catalog(lab, clock)
        await models.resolve("local/qwen3-30b")
        await models.resolve("local/qwen3-30b")
        assert lab.calls.count("/api/tags") == 1

        lab.gpu_on = False
        clock.now += PROBE_TTL + 1

        assert await models.resolve("local/qwen3-30b") == "claude-haiku-4-5"
        assert lab.calls.count("/api/tags") == 2
