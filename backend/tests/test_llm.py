"""Provider-boundary tests for the optional LLM explanation layer."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.services.ai import llm


def run(coroutine):
    """Run one async provider call without adding an async test dependency."""
    return asyncio.run(coroutine)


def test_openai_request_shape_and_response_extraction(monkeypatch) -> None:
    calls = []

    class Completions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="  OpenAI answer  "))]
            )

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    monkeypatch.setattr(llm, "_get_openai_client", lambda: client)
    monkeypatch.setattr(llm.settings, "llm_max_tokens", 321)

    result = run(llm._complete_with("openai", "gpt-test", "system", "user"))

    assert result == "OpenAI answer"
    assert calls == [
        {
            "model": "gpt-test",
            "max_tokens": 321,
            "messages": [
                {"role": "system", "content": "system"},
                {"role": "user", "content": "user"},
            ],
        }
    ]


def test_anthropic_request_shape_and_text_response(monkeypatch) -> None:
    calls = []

    class Messages:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                stop_reason="end_turn",
                content=[
                    SimpleNamespace(type="text", text=" Anthropic "),
                    SimpleNamespace(type="tool_use", text="ignored"),
                    SimpleNamespace(type="text", text="answer "),
                ],
            )

    client = SimpleNamespace(messages=Messages())
    monkeypatch.setattr(llm, "_get_anthropic_client", lambda: client)
    monkeypatch.setattr(llm.settings, "llm_max_tokens", 654)

    result = run(llm._complete_with("anthropic", "claude-test", "system", "user"))

    assert result == "Anthropic answer"
    assert calls == [
        {
            "model": "claude-test",
            "max_tokens": 654,
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": "low"},
            "system": "system",
            "messages": [{"role": "user", "content": "user"}],
        }
    ]


def test_anthropic_refusal_becomes_provider_failure(monkeypatch) -> None:
    class Messages:
        async def create(self, **_kwargs):
            return SimpleNamespace(
                stop_reason="refusal",
                content=[SimpleNamespace(type="text", text="refused")],
            )

    monkeypatch.setattr(
        llm,
        "_get_anthropic_client",
        lambda: SimpleNamespace(messages=Messages()),
    )

    assert run(llm._complete_with("anthropic", "claude-test", "system", "user")) is None


def test_primary_provider_failure_falls_back_to_secondary(monkeypatch) -> None:
    monkeypatch.setattr(llm.settings, "llm_provider", "openai")
    monkeypatch.setattr(llm.settings, "llm_model", "primary-model")
    monkeypatch.setattr(llm.settings, "openai_api_key", "openai-key")
    monkeypatch.setattr(llm.settings, "anthropic_api_key", "anthropic-key")
    calls = []

    async def complete(provider, model, system, user):
        calls.append((provider, model, system, user))
        return None if provider == "openai" else "secondary answer"

    monkeypatch.setattr(llm, "_complete_with", complete)

    assert run(llm._complete("system", "user")) == "secondary answer"
    assert calls == [
        ("openai", "primary-model", "system", "user"),
        ("anthropic", llm._FALLBACK_MODEL["anthropic"], "system", "user"),
    ]


def test_all_provider_failures_return_deterministic_fallback_signal(monkeypatch) -> None:
    monkeypatch.setattr(llm.settings, "llm_provider", "openai")
    monkeypatch.setattr(llm.settings, "llm_model", "primary-model")
    monkeypatch.setattr(llm.settings, "openai_api_key", "openai-key")
    monkeypatch.setattr(llm.settings, "anthropic_api_key", "anthropic-key")

    async def fail(*_args):
        return None

    monkeypatch.setattr(llm, "_complete_with", fail)

    assert run(llm._complete("system", "user")) is None


def test_compliance_violation_gets_one_stricter_retry(monkeypatch) -> None:
    responses = iter(["You should buy now.", "This changes portfolio risk."])
    systems = []

    async def complete(system, _user):
        systems.append(system)
        return next(responses)

    monkeypatch.setattr(llm, "_complete", complete)

    assert run(llm._compliant("base system", "user")) == "This changes portfolio risk."
    assert systems == ["base system", "base system" + llm._STRICTER]


def test_noncompliant_retry_returns_deterministic_fallback_signal(monkeypatch) -> None:
    responses = iter(["Buy now.", "This is a guaranteed return."])

    async def complete(_system, _user):
        return next(responses)

    monkeypatch.setattr(llm, "_complete", complete)

    assert run(llm._compliant("system", "user")) is None
