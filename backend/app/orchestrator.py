"""The stock-analysis pipeline — real agent orchestration.

Each named agent is a timed step over the deterministic services; the emitted
AgentEvents ARE the audit trail the UI renders (replacing the old static
strings). Deterministic code computes every number; the AI layer only narrates
(Memo Writer), and the Compliance Agent validates that narration.
"""
from __future__ import annotations

from time import perf_counter
from typing import List

from .config import settings
from .marketdata.resolver import resolver
from .schemas import AgentEvent, StockAnalyzeRequest, StockAnalyzeResponse
from .services.ai.compliance import violations
from .services.ai.format import currency, pct
from .services.ai.llm import write_memo
from .services.ai.memo import template_memo
from .services.impact import compute_impact
from .services.stock import analyze_stock


async def run_stock_analysis(req: StockAnalyzeRequest) -> StockAnalyzeResponse:
    events: List[AgentEvent] = []

    def emit(agent: str, detail: str, t0: float, status: str = "succeeded") -> None:
        events.append(
            AgentEvent(
                agent=agent,
                status=status,  # type: ignore[arg-type]
                duration_ms=(perf_counter() - t0) * 1000,
                detail=detail,
            )
        )

    # Ticker Intake Agent — normalize inputs.
    t = perf_counter()
    symbol = (req.ticker or "AAPL").strip().upper() or "AAPL"
    try:
        horizon = float(req.days)
    except (TypeError, ValueError):
        horizon = 30.0
    if not horizon or horizon != horizon:
        horizon = 30.0
    horizon = max(7.0, min(365.0, horizon))
    emit("Ticker Intake Agent", f"{symbol} normalized, {horizon:g}-day horizon", t)

    # Market Data Tool — live provider chain with offline backstop.
    t = perf_counter()
    snapshot = await resolver.resolve(symbol)
    detail = f"price {currency(snapshot.price or 0)} via {snapshot.source}"
    if snapshot.as_of:
        detail += f", as of {snapshot.as_of}"
    emit("Market Data Tool", detail, t)

    # Stock Forecast Agent — deterministic bands over the snapshot.
    t = perf_counter()
    forecast = analyze_stock(symbol, horizon, snapshot)
    emit(
        "Stock Forecast Agent",
        f"median target {currency(forecast.median_target)}, confidence {pct(forecast.confidence)}",
        t,
    )

    # Backtest Agent — prototype sample windows.
    t = perf_counter()
    emit(
        "Backtest Agent",
        f"{forecast.backtest.windows} sample windows, hit rate {pct(forecast.backtest.hit)}",
        t,
    )

    # Portfolio Agent — the what-if against the sent holdings.
    t = perf_counter()
    impact = None
    if req.holdings and req.profile:
        impact = compute_impact(forecast, req.holdings, req.profile)
    if impact is not None:
        emit(
            "Portfolio Agent",
            f"what-if: {symbol} would be {pct(impact.new_weight)} of the portfolio",
            t,
        )
    else:
        emit("Portfolio Agent", "no holdings provided — impact analysis skipped", t, "skipped")

    # Memo Writer — the AI layer (LLM when configured, template otherwise).
    t = perf_counter()
    memo, narrator = await write_memo(forecast, impact)
    emit(
        "Memo Writer",
        (
            f"memo narrated via LLM ({settings.llm_model})"
            if narrator == "llm"
            else "memo narrated via deterministic template"
        ),
        t,
    )

    # Compliance Agent — enforcement over whatever the narrator produced.
    t = perf_counter()
    if any(violations(line) for line in memo):
        memo, narrator = template_memo(forecast, impact), "template"
        emit("Compliance Agent", "narration rejected; deterministic template served", t)
    else:
        emit("Compliance Agent", "educational framing verified — no advice language", t)

    return StockAnalyzeResponse(
        forecast=forecast, impact=impact, events=events, memo=memo, narrator=narrator
    )
