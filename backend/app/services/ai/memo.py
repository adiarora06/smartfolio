"""Deterministic memo templates — the always-available narration fallback.

Mirrors frontend/src/lib/ai/memo.ts (forecast lines) plus the impact narration.
"""
from __future__ import annotations

from typing import List, Optional

from ...schemas import PortfolioImpact, StockForecast
from .format import currency, title_case
from .insights import describe_impact


def template_memo(
    forecast: StockForecast, impact: Optional[PortfolioImpact]
) -> List[str]:
    lines = [
        f"{forecast.symbol} maps to a {forecast.rating.lower()} setup over {forecast.days:g} days.",
        (
            f"Median target is {currency(forecast.median_target)}, with range "
            f"{currency(forecast.bear_target)} to {currency(forecast.bull_target)}."
        ),
        f"Check {title_case(forecast.sector)} exposure before adding more.",
    ]
    if impact is not None:
        lines.extend(describe_impact(impact, forecast.symbol))
    return lines
