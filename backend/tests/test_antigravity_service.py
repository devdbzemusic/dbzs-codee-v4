import asyncio

import app.antigravity.service as module


def test_provider_is_unavailable_without_optional_sdk(monkeypatch):
    monkeypatch.setattr(module, "Agent", None)
    service = module.AntigravityAgentService()
    assert service.is_available() is False


def test_provider_denies_all_sdk_tools(monkeypatch):
    captured = {}

    class FakePolicy:
        @staticmethod
        def deny_all():
            return "deny-all"

    class FakeConfig:
        def __init__(self, **kwargs):
            captured.update(kwargs)
            self.model = "test-model"

    class FakeResponse:
        async def text(self):
            return "ok"

    class FakeAgent:
        def __init__(self, config):
            self.config = config

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def chat(self, _prompt):
            return FakeResponse()

    monkeypatch.setattr(module, "Agent", FakeAgent)
    monkeypatch.setattr(module, "LocalAgentConfig", FakeConfig)
    monkeypatch.setattr(module, "policy", FakePolicy)
    monkeypatch.setattr(module, "_IMPORT_ERROR", None)
    result = asyncio.run(module.AntigravityAgentService(api_key="EXAMPLE_KEY").run_prompt("hello", tools=[lambda: None]))
    assert result.text == "ok"
    assert captured["tools"] == []
    assert captured["policies"] == ["deny-all"]
