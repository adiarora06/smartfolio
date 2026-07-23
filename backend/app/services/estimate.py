"""Turning measured data into the two model parameters: sigma and mu.

Split out of the engine so the walk-forward backtest can call exactly the same
estimator the live forecast uses. If the backtest used a different (or better-
informed) estimator its reported accuracy would be meaningless.

Fundamentals are deliberately optional here. When replaying a past origin we
only have the price history that existed on that date — we do not have the
company's fundamentals as they were reported then — so the backtest runs the
history-only path, and its accuracy numbers describe that path honestly.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional

from ..marketdata.fundamentals import Fundamentals, QualityScore
from ..marketdata.series import SeriesStats
from .quant import (
    ANALYST_OPTIMISM_BIAS,
    MARKET_DRIFT,
    MARKET_VOL,
    DriftEstimate,
    DriftSignal,
    blend_drift,
)

# Raw trailing returns are terrible point forecasts of future returns. These
# damping factors are the fraction of a trailing signal carried into the drift
# estimate; the rest is discarded before blending and shrinking.
MOMENTUM_DAMPING = 0.30
MEDIUM_MOMENTUM_DAMPING = 0.22
SENTIMENT_SCALE = 0.06  # a maximally positive news tape moves drift by 6pp

# Volatility bounds. Below the floor the cone collapses to a line and implies
# certainty that does not exist; above the ceiling a single crash window would
# dominate every forecast the ticker ever produces.
VOL_FLOOR = 0.06
VOL_CEILING = 1.20


def estimate_vol(stats: Optional[SeriesStats], fallback: Optional[float]) -> tuple[float, bool]:
    """(annualized sigma, measured?).

    Blends the EWMA estimate with the equal-weighted one. EWMA alone reacts
    fast but is jumpy over a 30-90 day horizon; the 70/30 blend keeps most of
    that responsiveness while anchoring to the fuller sample.
    """
    if stats is not None and stats.vol > 0:
        blended = 0.70 * stats.vol + 0.30 * stats.vol_simple
        return min(max(blended, VOL_FLOOR), VOL_CEILING), True
    base = fallback if fallback and fallback > 0 else MARKET_VOL
    return min(max(base, VOL_FLOOR), VOL_CEILING), False


def _annualized(total_return: float, months: float) -> float:
    """Convert a trailing total return to an annualized rate."""
    if months <= 0:
        return 0.0
    growth = 1.0 + total_return
    if growth <= 0:
        return -0.95
    return growth ** (12.0 / months) - 1.0


def history_signals(stats: Optional[SeriesStats]) -> List[DriftSignal]:
    """Drift signals available from price history alone."""
    if stats is None:
        return []
    signals: List[DriftSignal] = []

    if stats.momentum_12_1 is not None:
        value = stats.momentum_12_1 * MOMENTUM_DAMPING
        signals.append(
            DriftSignal(
                name="momentum_12_1",
                value=value,
                weight=1.0,
                detail=(
                    f"12-1 momentum {stats.momentum_12_1:+.1%}, "
                    f"damped to {value:+.1%}"
                ),
            )
        )

    if stats.return_6m is not None:
        annual = _annualized(stats.return_6m, 6)
        value = annual * MEDIUM_MOMENTUM_DAMPING
        signals.append(
            DriftSignal(
                name="momentum_6m",
                value=value,
                weight=0.6,
                detail=f"6-month return {stats.return_6m:+.1%} annualized to {annual:+.1%}",
            )
        )

    # Trend quality: a high trailing Sharpe means the drift that produced it was
    # less likely to be noise, so it earns a small tilt of its own.
    if stats.sharpe_trailing is not None:
        value = MARKET_DRIFT + max(-1.5, min(1.5, stats.sharpe_trailing)) * 0.03
        signals.append(
            DriftSignal(
                name="trailing_sharpe",
                value=value,
                weight=0.5,
                detail=f"trailing Sharpe {stats.sharpe_trailing:.2f}",
            )
        )

    return signals


def fundamental_signals(
    fundamentals: Optional[Fundamentals],
    quality: QualityScore,
    price: float,
) -> List[DriftSignal]:
    """Drift signals that need an OVERVIEW payload."""
    if fundamentals is None:
        return []
    signals: List[DriftSignal] = []

    target = fundamentals.analyst_target
    if target and target > 0 and price > 0:
        implied = target / price - 1.0
        value = implied - ANALYST_OPTIMISM_BIAS
        signals.append(
            DriftSignal(
                name="analyst_target",
                value=value,
                weight=1.0,
                detail=(
                    f"consensus target ${target:,.2f} implies {implied:+.1%}, "
                    f"less {ANALYST_OPTIMISM_BIAS:.0%} optimism bias"
                ),
            )
        )

    earnings_yield = fundamentals.earnings_yield
    if earnings_yield is not None:
        # Anchored on the market's own earnings yield (~4.5%): cheaper than the
        # market on earnings is a positive tilt, richer is a negative one.
        value = MARKET_DRIFT + (earnings_yield - 0.045) * 0.6
        signals.append(
            DriftSignal(
                name="earnings_yield",
                value=value,
                weight=0.5,
                detail=f"earnings yield {earnings_yield:.1%} vs market 4.5%",
            )
        )

    if quality.measured:
        value = MARKET_DRIFT + (quality.value - 0.5) * 0.08
        signals.append(
            DriftSignal(
                name="quality",
                value=value,
                weight=0.5,
                detail=f"fundamental quality {quality.value:.2f}",
            )
        )

    return signals


def sentiment_signal(sentiment: Optional[float], articles: int) -> List[DriftSignal]:
    """News tone as a small drift tilt.

    Weighted by article count because a score built from three articles is
    noise; it saturates at twenty so a heavily-covered mega-cap does not get
    unbounded confidence from coverage volume alone.
    """
    if sentiment is None or articles <= 0:
        return []
    confidence = min(articles / 20.0, 1.0)
    return [
        DriftSignal(
            name="news_sentiment",
            value=MARKET_DRIFT + sentiment * SENTIMENT_SCALE,
            weight=0.4 * confidence,
            detail=f"news tone {sentiment:+.2f} across {articles} tagged articles",
        )
    ]


def shrinkage_for(completeness: float, observations: int) -> float:
    """How much to trust the blended signal versus the market prior.

    Two independent gates: how many of the model's inputs arrived at all, and
    how long the price history behind the statistical ones is. A ticker with
    three months of data does not get the same conviction as one with three
    years, even if every endpoint responded.
    """
    data_gate = min(max(completeness, 0.0), 1.0)
    length_gate = min(observations / 504.0, 1.0) if observations > 0 else 0.0
    combined = 0.6 * data_gate + 0.4 * length_gate
    return 0.15 + 0.45 * combined


@dataclass(frozen=True)
class Parameters:
    """The estimated model parameters plus their provenance."""

    mu: float
    sigma: float
    vol_measured: bool
    drift: DriftEstimate


def estimate_from_history(
    stats: Optional[SeriesStats], fallback_vol: Optional[float] = None
) -> Parameters:
    """History-only estimation — the path the walk-forward backtest replays."""
    sigma, measured = estimate_vol(stats, fallback_vol)
    signals = history_signals(stats)
    observations = stats.observations if stats else 0
    completeness = 0.7 if stats is not None else 0.0
    drift = blend_drift(signals, shrinkage_for(completeness, observations))
    return Parameters(mu=drift.mu, sigma=sigma, vol_measured=measured, drift=drift)


def estimate_full(
    stats: Optional[SeriesStats],
    fundamentals: Optional[Fundamentals],
    quality: QualityScore,
    sentiment: Optional[float],
    articles: int,
    price: float,
    completeness: float,
    fallback_vol: Optional[float] = None,
) -> Parameters:
    """The live path — every available signal, blended and shrunk."""
    sigma, measured = estimate_vol(stats, fallback_vol)

    # A beta-implied floor: a high-beta name cannot be less volatile than the
    # market move it inherits, whatever a short sample happens to show.
    if fundamentals is not None and fundamentals.beta and fundamentals.beta > 0:
        sigma = max(sigma, abs(fundamentals.beta) * MARKET_VOL * 0.75)
        sigma = min(sigma, VOL_CEILING)

    signals = (
        history_signals(stats)
        + fundamental_signals(fundamentals, quality, price)
        + sentiment_signal(sentiment, articles)
    )
    observations = stats.observations if stats else 0
    drift = blend_drift(signals, shrinkage_for(completeness, observations))
    return Parameters(mu=drift.mu, sigma=sigma, vol_measured=measured, drift=drift)


def annualized_from_log(log_return: float, years: float) -> float:
    """Helper for reporting: log return over `years` -> annualized simple rate."""
    if years <= 0:
        return 0.0
    return math.exp(log_return / years) - 1.0
