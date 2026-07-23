"""Walk-forward backtest — what the forecast actually did on real history.

The method, which is the whole point: pick N past origin dates. At each one,
truncate the price series to that date so the estimator sees exactly what it
would have seen then and nothing after it, run the same estimator the live
forecast uses, and compare the band it produced to the price that actually
occurred one horizon later.

This makes the headline metric *calibration*, not accuracy. A forecast band is
well-calibrated when reality lands inside the 25-75 band about 50% of the time
and inside the 5-95 band about 90% of the time. A model that is confidently
wrong and a model that hedges everything both score badly, in opposite
directions, and the two coverage numbers tell you which.

Directional hit rate and median absolute error are reported alongside, but
coverage is the number that says whether the cone means anything.

One caveat this module reports rather than hides: with a 90-day horizon and
origins spaced ~20 trading days apart, consecutive windows share most of their
price path. Twenty-four such windows carry nowhere near twenty-four windows'
worth of independent evidence, so `independent_windows` estimates how many
non-overlapping horizons the sample actually spans. Read the coverage numbers
against that, not against the raw window count.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from ..marketdata.series import PriceSeries, compute_stats
from .estimate import estimate_from_history
from .quant import quantile_price


@dataclass(frozen=True)
class BacktestWindow:
    """One replayed origin and its outcome."""

    origin_date: str
    resolved_date: str
    origin_price: float
    realized_price: float
    predicted_median: float
    predicted_q25: float
    predicted_q75: float
    predicted_q05: float
    predicted_q95: float

    @property
    def realized_return(self) -> float:
        return self.realized_price / self.origin_price - 1.0

    @property
    def predicted_return(self) -> float:
        return self.predicted_median / self.origin_price - 1.0

    @property
    def in_interquartile(self) -> bool:
        return self.predicted_q25 <= self.realized_price <= self.predicted_q75

    @property
    def in_outer_band(self) -> bool:
        return self.predicted_q05 <= self.realized_price <= self.predicted_q95

    @property
    def directional_hit(self) -> bool:
        return (self.predicted_return >= 0) == (self.realized_return >= 0)

    @property
    def absolute_error(self) -> float:
        """|median forecast - realized| as a fraction of the realized price."""
        return abs(self.predicted_median - self.realized_price) / self.realized_price


@dataclass(frozen=True)
class BacktestReport:
    windows: int
    # Non-overlapping horizons the sample actually spans. Always <= `windows`,
    # and the number the coverage figures should really be judged against.
    independent_windows: float
    horizon_days: int
    coverage_50: float  # fraction landing inside the 25-75 band
    coverage_90: float  # fraction landing inside the 5-95 band
    directional_hit: float
    median_absolute_error: float  # decimal fraction of price
    bias: float  # mean signed forecast error; >0 = systematically optimistic
    realized_max_drawdown: float
    worst_window: Optional[float]  # most negative realized return observed
    best_window: Optional[float]
    first_origin: str
    last_origin: str

    @property
    def calibration_error(self) -> float:
        """Distance from perfect calibration, averaged over both bands."""
        return (abs(self.coverage_50 - 0.50) + abs(self.coverage_90 - 0.90)) / 2


def _median(values: List[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def _max_drawdown(closes: List[float]) -> float:
    peak = closes[0] if closes else 0.0
    worst = 0.0
    for c in closes:
        peak = max(peak, c)
        if peak > 0:
            worst = min(worst, c / peak - 1.0)
    return worst


def walk_forward(
    series: PriceSeries,
    horizon_days: float,
    origins: int = 24,
    min_history: int = 180,
) -> Optional[BacktestReport]:
    """Replay the estimator across past origins. None when history is too short.

    `min_history` is the number of observations the estimator needs behind an
    origin before its output is worth scoring; `horizon_trading_days` converts
    the calendar horizon the user asked for into series positions.
    """
    horizon_trading_days = max(1, int(round(horizon_days * 252 / 365)))
    total = len(series)

    # Need history behind the first origin and a full horizon after the last.
    first_origin = min_history
    last_origin = total - horizon_trading_days - 1
    if last_origin <= first_origin:
        return None

    span = last_origin - first_origin
    step = max(1, span // max(origins, 1))
    indices = list(range(first_origin, last_origin + 1, step))[:origins]
    if len(indices) < 4:
        return None

    windows: List[BacktestWindow] = []
    for i in indices:
        past = series.truncate_to(i)
        stats = compute_stats(past)
        if stats is None:
            continue
        params = estimate_from_history(stats)

        origin_price = past.closes[-1]
        resolved_index = i + horizon_trading_days
        realized_price = series.closes[resolved_index]
        if origin_price <= 0 or realized_price <= 0:
            continue

        t = horizon_days / 365.0
        windows.append(
            BacktestWindow(
                origin_date=past.dates[-1],
                resolved_date=series.dates[resolved_index],
                origin_price=origin_price,
                realized_price=realized_price,
                predicted_median=quantile_price(origin_price, params.mu, params.sigma, t, 0.50),
                predicted_q25=quantile_price(origin_price, params.mu, params.sigma, t, 0.25),
                predicted_q75=quantile_price(origin_price, params.mu, params.sigma, t, 0.75),
                predicted_q05=quantile_price(origin_price, params.mu, params.sigma, t, 0.05),
                predicted_q95=quantile_price(origin_price, params.mu, params.sigma, t, 0.95),
            )
        )

    if len(windows) < 4:
        return None

    n = len(windows)
    realized = [w.realized_return for w in windows]
    errors = [w.predicted_return - w.realized_return for w in windows]

    # Calendar span the origins cover, divided by one horizon — i.e. how many
    # non-overlapping forecasts would fit in the same stretch of history.
    origin_span = indices[-1] - indices[0] + horizon_trading_days
    independent = min(float(n), max(1.0, origin_span / horizon_trading_days))

    return BacktestReport(
        windows=n,
        independent_windows=round(independent, 1),
        horizon_days=int(round(horizon_days)),
        coverage_50=sum(1 for w in windows if w.in_interquartile) / n,
        coverage_90=sum(1 for w in windows if w.in_outer_band) / n,
        directional_hit=sum(1 for w in windows if w.directional_hit) / n,
        median_absolute_error=_median([w.absolute_error for w in windows]),
        bias=sum(errors) / n,
        realized_max_drawdown=_max_drawdown(series.closes),
        worst_window=min(realized),
        best_window=max(realized),
        first_origin=windows[0].origin_date,
        last_origin=windows[-1].origin_date,
    )
