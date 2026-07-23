"""Deterministic memo templates — the always-available narration fallback.

Mirrors frontend/src/lib/ai/memo.ts (forecast lines) plus the impact narration.

Every line here is phrased as a property of the fitted distribution rather than
as a claim about what the stock will do, and lines that would imply measurement
are only emitted when the underlying input was actually measured.
"""
from __future__ import annotations

from typing import List, Optional

from ...schemas import PortfolioImpact, StockForecast
from .format import currency, pct, title_case
from .insights import describe_impact


def _band_line(forecast: StockForecast) -> str:
    return (
        f"The central 50% of the modelled range over {forecast.days:g} days runs "
        f"{currency(forecast.q25_target)} to {currency(forecast.q75_target)}, "
        f"around a median of {currency(forecast.median_target)}; the 5th-95th "
        f"percentile range is {currency(forecast.bear_target)} to "
        f"{currency(forecast.bull_target)}."
    )


def _inputs_line(forecast: StockForecast) -> Optional[str]:
    inputs = forecast.inputs
    if inputs is None:
        return None
    if inputs.vol_measured:
        basis = f"{pct(inputs.sigma)} annualized volatility measured from price history"
    else:
        basis = f"an assumed {pct(inputs.sigma)} annualized volatility (no history available)"
    return (
        f"The band is built from {basis}, with a drift estimate of {pct(inputs.mu)} "
        f"after shrinking {pct(1 - inputs.shrinkage)} of the raw signal toward a "
        f"market baseline."
    )


def _backtest_line(forecast: StockForecast) -> Optional[str]:
    bt = forecast.backtest
    if not bt.measured or bt.coverage50 is None or bt.coverage90 is None:
        return None
    line = (
        f"Replayed across {bt.windows} past {forecast.days:g}-day windows, outcomes "
        f"landed inside the 25-75 band {pct(bt.coverage50)} of the time (target 50%) "
        f"and inside the 5-95 band {pct(bt.coverage90)} of the time (target 90%)."
    )
    if bt.independent_windows:
        line += (
            f" Those windows overlap, so they span about "
            f"{bt.independent_windows:g} independent horizons."
        )
    return line


def template_memo(
    forecast: StockForecast, impact: Optional[PortfolioImpact]
) -> List[str]:
    lines: List[str] = [
        f"{forecast.symbol} maps to a {forecast.rating.lower()} setup over "
        f"{forecast.days:g} days, with a modelled {pct(forecast.prob_gain)} chance of "
        f"finishing above today's price.",
        _band_line(forecast),
    ]

    inputs_line = _inputs_line(forecast)
    if inputs_line:
        lines.append(inputs_line)

    if forecast.prob_drawdown20 > 0.10:
        lines.append(
            f"The same model puts a {pct(forecast.prob_drawdown20)} chance of a 20% "
            f"drawdown at some point within the horizon, and "
            f"{pct(forecast.prob_drawdown10)} for a 10% drawdown."
        )

    backtest_line = _backtest_line(forecast)
    if backtest_line:
        lines.append(backtest_line)

    if forecast.stats is not None:
        s = forecast.stats
        if s.pct_of_52w_range is not None:
            lines.append(
                f"Price sits at {pct(s.pct_of_52w_range)} of its 52-week range, with a "
                f"deepest peak-to-trough decline of {pct(s.max_drawdown)} over "
                f"{s.observations} observed sessions."
            )

    lines.append(f"Check {title_case(forecast.sector)} exposure before adding more.")

    if impact is not None:
        lines.extend(describe_impact(impact, forecast.symbol))
    return lines
