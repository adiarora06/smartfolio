"""LLM provider routing for the AI explanation layer.

Supports: Anthropic (Claude) or OpenAI (GPT).
Fallback: the deterministic templates (always available — keyless deploys are
byte-identical to the pre-LLM behavior).

Hard rules enforced here:
- The LLM receives deterministic results as READ-ONLY JSON context and is
  instructed never to invent numbers.
- Output is validated by the compliance module; one stricter retry, then the
  template fallback. The disclaimer is appended server-side, never left to the
  model.
"""
from __future__ import annotations

import json
from typing import List, Optional, Tuple

from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

from ...config import settings
from ...schemas import Narrator, PortfolioAnalysis, PortfolioImpact, StockForecast
from .compliance import DISCLAIMER, violations, with_disclaimer
from .format import pct, title_case
from .insights import describe_concentrations, describe_recommendations
from .memo import template_memo

_anthropic_client: Optional[AsyncAnthropic] = None
_openai_client: Optional[AsyncOpenAI] = None


def _get_anthropic_client() -> AsyncAnthropic:
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            timeout=settings.llm_timeout,
            max_retries=1,
        )
    return _anthropic_client


def _get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            timeout=settings.llm_timeout,
        )
    return _openai_client


_MEMO_SYSTEM = """You write SmartFolio's stock research memos.

Rules:
- Use ONLY the numbers in the provided JSON context. Never invent, round differently, or extrapolate figures.
- Educational framing only: no buy/sell recommendations, no guarantees, no promises of returns.
- Write 3-5 short standalone sentences, one per line. Plain text - no markdown, no bullets, no headers.
- If portfolio impact data is present, cover how the position would change portfolio weight and sector exposure."""

_ADVISOR_SYSTEM = """You are SmartFolio's educational portfolio advisor.

Rules:
- Ground every statement in the numbers from the provided JSON context. Never invent figures.
- Educational framing only: explain how things affect risk, diversification, and goals. No buy/sell recommendations, no guarantees.
- Answer in 2-4 plain sentences. No markdown."""

_STRICTER = """

STRICT REWRITE: Your previous draft contained non-compliant language (e.g. guarantees or buy/sell imperatives). Rewrite the response without any such phrasing."""


# Model used when a provider runs as FALLBACK (the primary uses LLM_MODEL).
_FALLBACK_MODEL = {"openai": "gpt-4o-mini", "anthropic": "claude-sonnet-5"}


def _has_key(provider: str) -> bool:
    return bool(
        settings.openai_api_key if provider == "openai" else settings.anthropic_api_key
    )


def _provider_chain() -> List[str]:
    """Providers to try in order: configured primary first, other key as backup."""
    chain: List[str] = []
    for provider in (settings.llm_provider, "openai", "anthropic"):
        if provider in _FALLBACK_MODEL and _has_key(provider) and provider not in chain:
            chain.append(provider)
    return chain


async def _complete_with(provider: str, model: str, system: str, user: str) -> Optional[str]:
    """One call against one provider; None on any failure."""
    try:
        if provider == "openai":
            resp = await _get_openai_client().chat.completions.create(
                model=model,
                max_tokens=settings.llm_max_tokens,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            )
            text = resp.choices[0].message.content or ""
            return text.strip() or None
        resp = await _get_anthropic_client().messages.create(
            model=model,
            max_tokens=settings.llm_max_tokens,
            thinking={"type": "adaptive"},
            output_config={"effort": "low"},
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        if resp.stop_reason == "refusal":
            return None
        text = "".join(b.text for b in resp.content if b.type == "text").strip()
        return text or None
    except Exception:
        # Timeout, auth, rate limit, network — try the next provider.
        return None


async def _complete(system: str, user: str) -> Optional[str]:
    """Try each configured provider in order; None -> deterministic template."""
    if not settings.llm_enabled:
        return None
    for provider in _provider_chain():
        model = (
            settings.llm_model
            if provider == settings.llm_provider
            else _FALLBACK_MODEL[provider]
        )
        text = await _complete_with(provider, model, system, user)
        if text is not None:
            return text
    return None


async def _compliant(system: str, user: str) -> Optional[str]:
    """Complete, validate, retry once stricter, else None."""
    text = await _complete(system, user)
    if text is None:
        return None
    if not violations(text):
        return text
    retry = await _complete(system + _STRICTER, user)
    if retry is not None and not violations(retry):
        return retry
    return None


def _forecast_context(forecast: StockForecast) -> dict:
    return {
        "symbol": forecast.symbol,
        "name": forecast.name,
        "sector": title_case(forecast.sector),
        "price": round(forecast.price, 2),
        "horizonDays": forecast.days,
        "rating": forecast.rating,
        "confidence": pct(forecast.confidence),
        "medianTarget": round(forecast.median_target, 2),
        "bearTarget": round(forecast.bear_target, 2),
        "bullTarget": round(forecast.bull_target, 2),
        "expectedReturn": pct(forecast.expected),
        "priceSource": forecast.source,
        "asOf": forecast.as_of,
        "backtest": forecast.backtest.model_dump(by_alias=True),
    }


async def write_memo(
    forecast: StockForecast, impact: Optional[PortfolioImpact]
) -> Tuple[List[str], Narrator]:
    """Research memo lines + which engine narrated them."""
    template = template_memo(forecast, impact)
    if not settings.llm_enabled:
        return template, "template"

    context = {"forecast": _forecast_context(forecast)}
    if impact is not None:
        context["portfolioImpact"] = impact.model_dump(by_alias=True)
    user = (
        "Write the research memo for this analysis run.\n\n"
        f"JSON context:\n{json.dumps(context, indent=2)}"
    )
    text = await _compliant(_MEMO_SYSTEM, user)
    if text is None:
        return template, "template"
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if DISCLAIMER not in lines:
        lines.append(DISCLAIMER)
    return lines, "llm"


async def answer_question(
    question: str,
    analysis: PortfolioAnalysis,
    stock: StockForecast,
    template_answer: str,
) -> Tuple[str, Narrator]:
    """Advisor answer + which engine produced it."""
    if not settings.llm_enabled:
        return template_answer, "template"

    context = {
        "riskProfile": analysis.risk_profile_name,
        "portfolioValue": round(analysis.value, 2),
        "current1YReturn": pct(analysis.current_return),
        "target1YReturn": pct(analysis.target_return),
        "concentrationFlags": describe_concentrations(analysis.concentrations),
        "recommendations": describe_recommendations(analysis.recommendations),
        "currentStock": _forecast_context(stock),
    }
    user = (
        f"User question: {question}\n\n"
        f"JSON context:\n{json.dumps(context, indent=2)}"
    )
    text = await _compliant(_ADVISOR_SYSTEM, user)
    if text is None:
        return template_answer, "template"
    return with_disclaimer(text), "llm"
