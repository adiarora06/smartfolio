"""Stock forecast engine — a lognormal price cone fitted to measured data.

What changed from the original engine, and why it matters:

The previous version projected `price * (1 + med * x)` — a straight line, with a
sine wave added for visual texture, and `vol`/`trend`/`quality` derived from a
hash of the ticker string. The bands were fixed multiples of that line, so they
had no distributional meaning: you could not read a probability off them.

This version fits sigma to realized volatility and mu to a shrunk blend of real
signals, then reports the actual quantiles of the resulting distribution. The
band widens with sqrt(t), the 25-75 band contains half the probability mass by
construction, and every headline number (P(gain), P(drawdown), the targets) is
a property of the same fitted distribution rather than a separate heuristic.

Deterministic throughout — same inputs, same output, no sampling.

Numbers only. The research memo prose is the AI layer's job.
"""
from __future__ import annotations

import math
from typing import List, Optional

from ..config import settings
from ..marketdata.base import MarketContext
from ..marketdata.fundamentals import quality_score
from ..marketdata.offline import offline_snapshot
from ..schemas import (
    BacktestResult,
    DriftSignalOut,
    ForecastInputs,
    ForecastPoint,
    FundamentalsOut,
    SeriesStatsOut,
    StockForecast,
    StockTrace,
)
from .backtest import walk_forward
from .data import AUDIT_TRACE, TOPOLOGY_TRACE
from .estimate import estimate_full
from .quant import (
    MARKET_DRIFT,
    cone,
    prob_above,
    prob_drawdown,
    prob_gain,
    quantile_price,
    quantile_return,
)

CONE_STEPS = 24


def _normalize_horizon(days: float) -> float:
    try:
        horizon = float(days)
    except (TypeError, ValueError):
        horizon = 30.0
    if not horizon or horizon != horizon:  # 0 or NaN
        horizon = 30.0
    return max(7.0, min(365.0, horizon))


def _rating(probability_gain: float, calibrated: bool) -> str:
    """Map P(gain) to the three-way rating.

    The thresholds sit close to a coin flip on purpose. Over a 30-90 day
    horizon a genuinely 70%-likely gain is not something this or any model can
    identify, and thresholds wide enough to look decisive would just be
    manufacturing confidence.
    """
    if probability_gain > 0.58:
        return "Constructive"
    if probability_gain > 0.46:
        return "Neutral"
    return "Cautious"


def _stats_out(ctx: MarketContext) -> Optional[SeriesStatsOut]:
    s = ctx.stats
    if s is None:
        return None
    return SeriesStatsOut(
        observations=s.observations,
        vol=s.vol,
        vol_simple=s.vol_simple,
        downside_vol=s.downside_vol,
        return_1m=s.return_1m,
        return_3m=s.return_3m,
        return_6m=s.return_6m,
        return_12m=s.return_12m,
        momentum_12m1=s.momentum_12_1,
        max_drawdown=s.max_drawdown,
        high_52w=s.high_52w,
        low_52w=s.low_52w,
        pct_of_52w_range=s.pct_of_52w_range,
        sharpe_trailing=s.sharpe_trailing,
    )


def _fundamentals_out(ctx: MarketContext) -> Optional[FundamentalsOut]:
    f = ctx.fundamentals
    if f is None:
        return None
    return FundamentalsOut(
        market_cap=f.market_cap,
        beta=f.beta,
        pe_ratio=f.pe_ratio,
        forward_pe=f.forward_pe,
        peg_ratio=f.peg_ratio,
        price_to_book=f.price_to_book,
        profit_margin=f.profit_margin,
        operating_margin=f.operating_margin,
        return_on_equity=f.return_on_equity,
        revenue_growth_yoy=f.revenue_growth_yoy,
        earnings_growth_yoy=f.earnings_growth_yoy,
        dividend_yield=f.dividend_yield,
        eps=f.eps,
        analyst_target=f.analyst_target,
        industry=f.industry,
    )


def _backtest(ctx: MarketContext, horizon: float, vol: float) -> BacktestResult:
    """Real walk-forward when history allows; an explicitly-unmeasured stub otherwise."""
    if ctx.series is not None:
        report = walk_forward(
            ctx.series,
            horizon,
            origins=settings.backtest_origins,
            min_history=settings.backtest_min_observations,
        )
        if report is not None:
            return BacktestResult(
                windows=report.windows,
                independent_windows=report.independent_windows,
                hit=report.directional_hit,
                error=report.median_absolute_error * 100,
                drawdown=report.realized_max_drawdown,
                coverage50=report.coverage_50,
                coverage90=report.coverage_90,
                bias=report.bias,
                calibration_error=report.calibration_error,
                worst_window=report.worst_window,
                best_window=report.best_window,
                first_origin=report.first_origin,
                last_origin=report.last_origin,
                measured=True,
            )

    # No history: report zero windows rather than a plausible-looking number.
    # The UI keys off `measured` to say "not enough history" instead of
    # presenting an assumption as a track record.
    return BacktestResult(
        windows=0,
        hit=0.5,
        error=vol * 100 * math.sqrt(horizon / 365),
        drawdown=-vol * 0.62,
        measured=False,
    )


def analyze_stock(
    ticker: str = "AAPL",
    days: float = 30,
    context: Optional[MarketContext] = None,
) -> StockForecast:
    symbol = ticker.strip().upper() or "AAPL"
    ctx = context or MarketContext(snapshot=offline_snapshot(symbol))
    snap = ctx.snapshot

    name = snap.name or f"{symbol} Corp."
    sector = snap.sector or "technology"
    price = float(snap.price if snap.price is not None else 0.0)

    horizon = _normalize_horizon(days)
    t = horizon / 365.0

    quality = quality_score(ctx.fundamentals, snap.quality if snap.quality is not None else 0.5)
    params = estimate_full(
        stats=ctx.stats,
        fundamentals=ctx.fundamentals,
        quality=quality,
        sentiment=ctx.sentiment,
        articles=ctx.sentiment_articles,
        price=price,
        completeness=ctx.data_completeness,
        fallback_vol=snap.vol,
    )
    mu, sigma = params.mu, params.sigma

    # The cone. Step 0 is the spot price for every quantile — the band opens
    # from a point rather than starting pre-spread.
    raw = cone(price, mu, sigma, t, steps=CONE_STEPS)
    paths: List[ForecastPoint] = [
        ForecastPoint(
            day=point["day"],
            q05=point["q05"],
            q25=point["q25"],
            q50=point["q50"],
            q75=point["q75"],
            q95=point["q95"],
            # Legacy aliases so older clients and stored runs keep rendering.
            bear=point["q05"],
            median=point["q50"],
            bull=point["q95"],
        )
        for point in raw
    ]

    median_target = quantile_price(price, mu, sigma, t, 0.50)
    probability_gain = prob_gain(mu, sigma, t)

    # P(beating a market-return benchmark over the same horizon) — the question
    # that actually matters for a single-stock decision, since the alternative
    # to holding this is holding the index.
    market_benchmark = price * math.exp(MARKET_DRIFT * t)
    probability_beat_market = prob_above(price, market_benchmark, mu, sigma, t)

    return StockForecast(
        symbol=symbol,
        name=name,
        sector=sector,
        price=price,
        days=horizon,
        vol=sigma,
        quality=quality.value,
        rating=_rating(probability_gain, params.vol_measured),  # type: ignore[arg-type]
        confidence=probability_gain,
        median_target=median_target,
        bear_target=quantile_price(price, mu, sigma, t, 0.05),
        bull_target=quantile_price(price, mu, sigma, t, 0.95),
        q25_target=quantile_price(price, mu, sigma, t, 0.25),
        q75_target=quantile_price(price, mu, sigma, t, 0.75),
        expected=quantile_return(mu, sigma, t, 0.50),
        expected_mean=math.exp(mu * t) - 1.0,
        prob_gain=probability_gain,
        prob_beat_market=probability_beat_market,
        prob_drawdown10=prob_drawdown(mu, sigma, t, 0.10),
        prob_drawdown20=prob_drawdown(mu, sigma, t, 0.20),
        annualized_vol=sigma,
        sentiment=ctx.sentiment,
        sentiment_articles=ctx.sentiment_articles,
        paths=paths,
        backtest=_backtest(ctx, horizon, sigma),
        inputs=ForecastInputs(
            mu=mu,
            sigma=sigma,
            drift_raw=params.drift.raw,
            shrinkage=params.drift.shrinkage,
            signals=[
                DriftSignalOut(
                    name=s.name, value=s.value, weight=s.weight, detail=s.detail
                )
                for s in params.drift.signals
            ],
            vol_measured=params.vol_measured,
            quality_measured=quality.measured,
            data_completeness=ctx.data_completeness,
            sources=list(ctx.sources),
            stale_inputs=list(ctx.stale_inputs),
            warnings=list(ctx.warnings),
        ),
        stats=_stats_out(ctx),
        fundamentals=_fundamentals_out(ctx),
        trace=StockTrace(audit=list(AUDIT_TRACE), topology=list(TOPOLOGY_TRACE)),
        source=snap.source,
        as_of=snap.as_of,
    )
