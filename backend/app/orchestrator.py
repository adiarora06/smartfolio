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

    # Market Data Tool — quote, daily history, fundamentals, and news tone,
    # each cached independently and each degrading on its own.
    t = perf_counter()
    ctx = await resolver.resolve(symbol)
    snapshot = ctx.snapshot
    detail = f"price {currency(snapshot.price or 0)} via {snapshot.source}"
    if snapshot.as_of:
        detail += f", as of {snapshot.as_of}"
    if ctx.stats is not None:
        detail += f"; {ctx.stats.observations} daily closes"
    if ctx.fundamentals is not None:
        detail += "; fundamentals loaded"
    if ctx.sentiment is not None:
        detail += f"; {ctx.sentiment_articles} news items"
    if ctx.stale_inputs:
        detail += f"; stale: {', '.join(ctx.stale_inputs)}"
    emit("Market Data Tool", detail, t)

    # Stock Forecast Agent — lognormal quantile cone over the measured inputs.
    t = perf_counter()
    forecast = analyze_stock(symbol, horizon, ctx)
    emit(
        "Stock Forecast Agent",
        (
            f"median target {currency(forecast.median_target)}, "
            f"25-75 band {currency(forecast.q25_target)}-{currency(forecast.q75_target)}, "
            f"P(gain) {pct(forecast.prob_gain)}"
        ),
        t,
    )

    # Parameter Estimation Agent — the drift/vol fit behind the cone.
    t = perf_counter()
    if forecast.inputs is not None:
        inputs = forecast.inputs
        emit(
            "Parameter Estimation Agent",
            (
                f"sigma {pct(inputs.sigma)} ({'measured' if inputs.vol_measured else 'assumed'}), "
                f"mu {pct(inputs.mu)} from {len(inputs.signals)} signal(s) "
                f"shrunk {pct(1 - inputs.shrinkage)} toward the market prior"
            ),
            t,
        )

    # Backtest Agent — real walk-forward when the history supports one.
    t = perf_counter()
    bt = forecast.backtest
    if bt.measured:
        emit(
            "Backtest Agent",
            (
                f"{bt.windows} walk-forward windows {bt.first_origin}..{bt.last_origin}; "
                f"band coverage {pct(bt.coverage50 or 0)}/50 and {pct(bt.coverage90 or 0)}/90, "
                f"directional {pct(bt.hit)}"
            ),
            t,
        )
    else:
        emit(
            "Backtest Agent",
            "insufficient price history to replay the engine — backtest skipped",
            t,
            "skipped",
        )

    # Portfolio Agent — the what-if against the sent holdings.
    t = perf_counter()
    impact = None
    if req.holdings and req.profile:
        impact = compute_impact(forecast, req.holdings, req.profile)
    if impact is not None:
        emit(
            "Portfolio Agent",
            (
                f"what-if: {symbol} would be {pct(impact.new_weight)} of value but "
                f"{pct(impact.risk_contribution)} of risk; portfolio vol "
                f"{pct(impact.vol_before)} -> {pct(impact.vol_after)}"
            ),
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
