"""Deterministic portfolio-impact analysis (the product's core question).

"How would adding this stock affect MY portfolio?" — pure what-if math over the
sent holdings. No prose here; the AI layer narrates the findings. Mirrored in
frontend/src/lib/calculations/impact.ts for offline parity.
"""
from __future__ import annotations

from typing import List, Optional

from ..schemas import Holding, InvestorProfile, PortfolioImpact, StockForecast
from .data import TARGETS
from .portfolio import EQUITY_ASSETS, portfolio_value, risk_profile

# Same thresholds as the concentration flags in portfolio.py.
SINGLE_STOCK_FLAG = 0.2
SECTOR_FLAG = 0.35


def compute_impact(
    forecast: StockForecast,
    holdings: List[Holding],
    profile: InvestorProfile,
) -> Optional[PortfolioImpact]:
    if not holdings:
        return None

    total = portfolio_value(holdings)
    if total <= 0:
        return None

    # Same default position size as the "Add To Portfolio" action.
    added = float(round(forecast.price * 10))
    total_after = total + added

    held = sum(
        float(h.value) for h in holdings if h.symbol.strip().upper() == forecast.symbol
    )
    new_weight = (held + added) / total_after

    sector_value = sum(
        float(h.value)
        for h in holdings
        if h.sector == forecast.sector and h.asset in EQUITY_ASSETS
    )
    sector_weight_after = (sector_value + added) / total_after

    # Allocation-gap shift: existing weights dilute by total/total_after; the
    # added position lands in us_equity (stocks in the terminal are US equity).
    name, _ = risk_profile(profile)
    target = TARGETS[name]
    current = {}
    for h in holdings:
        current[h.asset] = current.get(h.asset, 0.0) + float(h.value) / total
    after = {k: w * total / total_after for k, w in current.items()}
    after["us_equity"] = after.get("us_equity", 0.0) + added / total_after

    gap_delta = {}
    for k in sorted(set(current) | set(target) | {"us_equity"}):
        gap_before = target.get(k, 0.0) - current.get(k, 0.0)
        gap_after = target.get(k, 0.0) - after.get(k, 0.0)
        gap_delta[k] = gap_after - gap_before

    return PortfolioImpact(
        added_value=added,
        new_weight=new_weight,
        sector=forecast.sector,
        sector_weight_after=sector_weight_after,
        triggers_single_stock_flag=new_weight > SINGLE_STOCK_FLAG,
        triggers_sector_flag=sector_weight_after > SECTOR_FLAG,
        gap_delta=gap_delta,
    )
