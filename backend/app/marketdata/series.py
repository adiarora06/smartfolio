"""Historical price series + the statistics measured from it.

This is where the forecast engine's real inputs come from. Everything in
`SeriesStats` is measured from actual closes — none of it is derived from a
hash of the ticker string the way the offline reference table is.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional

from ..services.quant import (
    TRADING_DAYS,
    downside_vol,
    ewma_vol,
    stdev_vol,
)


@dataclass(frozen=True)
class PriceSeries:
    """Daily closes, oldest first. `dates` are ISO dates aligned to `closes`."""

    symbol: str
    dates: List[str]
    closes: List[float]

    def __len__(self) -> int:
        return len(self.closes)

    @property
    def latest(self) -> Optional[float]:
        return self.closes[-1] if self.closes else None

    @property
    def as_of(self) -> Optional[str]:
        return self.dates[-1] if self.dates else None

    def log_returns(self) -> List[float]:
        return [
            math.log(b / a)
            for a, b in zip(self.closes, self.closes[1:])
            if a > 0 and b > 0
        ]

    def window(self, days: int) -> "PriceSeries":
        """The most recent `days` observations."""
        if days <= 0 or days >= len(self.closes):
            return self
        return PriceSeries(self.symbol, self.dates[-days:], self.closes[-days:])

    def truncate_to(self, index: int) -> "PriceSeries":
        """Everything up to and including `index` — the walk-forward primitive.

        Backtesting has to see exactly what the engine would have seen on that
        date and nothing after it, or the result is look-ahead-biased fiction.
        """
        return PriceSeries(self.symbol, self.dates[: index + 1], self.closes[: index + 1])


@dataclass(frozen=True)
class SeriesStats:
    """Measured statistics — every field comes from real observed prices."""

    observations: int
    vol: float  # annualized, EWMA-weighted
    vol_simple: float  # annualized, equal-weighted over the window
    downside_vol: Optional[float]
    # Trailing total returns (decimal). None when the window is too short.
    return_1m: Optional[float]
    return_3m: Optional[float]
    return_6m: Optional[float]
    return_12m: Optional[float]
    # 12-1 momentum: 12-month return excluding the most recent month. The
    # standard construction — the skipped month removes short-term reversal.
    momentum_12_1: Optional[float]
    max_drawdown: float
    high_52w: Optional[float]
    low_52w: Optional[float]
    pct_of_52w_range: Optional[float]
    sharpe_trailing: Optional[float]


def _total_return(closes: List[float], lookback: int) -> Optional[float]:
    if len(closes) <= lookback:
        return None
    start, end = closes[-1 - lookback], closes[-1]
    if start <= 0:
        return None
    return end / start - 1.0


def _max_drawdown(closes: List[float]) -> float:
    """Deepest peak-to-trough decline over the window (negative decimal)."""
    peak = closes[0] if closes else 0.0
    worst = 0.0
    for c in closes:
        peak = max(peak, c)
        if peak > 0:
            worst = min(worst, c / peak - 1.0)
    return worst


def compute_stats(series: PriceSeries) -> Optional[SeriesStats]:
    """Measure a series. Returns None when there is too little data to be honest."""
    closes = series.closes
    if len(closes) < 30:
        return None

    returns = series.log_returns()
    vol_ewma = ewma_vol(returns)
    vol_simple = stdev_vol(returns)
    if vol_ewma is None and vol_simple is None:
        return None
    vol = vol_ewma if vol_ewma is not None else vol_simple
    vol_simple = vol_simple if vol_simple is not None else vol
    assert vol is not None and vol_simple is not None

    r1m = _total_return(closes, 21)
    r3m = _total_return(closes, 63)
    r6m = _total_return(closes, 126)
    r12m = _total_return(closes, 252)

    momentum = None
    if len(closes) > 252:
        start, end = closes[-253], closes[-22]
        if start > 0:
            momentum = end / start - 1.0

    year = closes[-min(len(closes), 252):]
    high_52w = max(year) if year else None
    low_52w = min(year) if year else None
    pct_range = None
    if high_52w is not None and low_52w is not None and high_52w > low_52w:
        pct_range = (closes[-1] - low_52w) / (high_52w - low_52w)

    sharpe = None
    if returns and vol > 0:
        mean_annual = (sum(returns) / len(returns)) * TRADING_DAYS
        sharpe = (mean_annual - 0.045) / vol

    return SeriesStats(
        observations=len(closes),
        vol=vol,
        vol_simple=vol_simple,
        downside_vol=downside_vol(returns),
        return_1m=r1m,
        return_3m=r3m,
        return_6m=r6m,
        return_12m=r12m,
        momentum_12_1=momentum,
        max_drawdown=_max_drawdown(closes),
        high_52w=high_52w,
        low_52w=low_52w,
        pct_of_52w_range=pct_range,
        sharpe_trailing=sharpe,
    )
