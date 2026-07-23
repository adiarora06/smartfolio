"""Deterministic portfolio-impact analysis (the product's core question).

"How would adding this stock affect MY portfolio?" — pure what-if math over the
sent holdings. No prose here; the AI layer narrates the findings.

Two distinct questions get answered, because they routinely disagree:

1. Concentration — does this position breach a weight limit? (weights only)
2. Risk — what does it do to portfolio volatility, beta, diversification, and
   return per unit of risk? (single-index model in services/risk.py)

A position can pass every concentration check and still be the largest single
contributor to portfolio risk, because risk contribution scales with volatility
and not just with weight. Reporting only the first question is what makes most
portfolio tools feel reassuring and useless.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from ..schemas import (
    Holding,
    InvestorProfile,
    PortfolioImpact,
    RiskContribution,
    StockForecast,
)
from .data import RETURNS, TARGETS
from .portfolio import EQUITY_ASSETS, portfolio_value, risk_profile
from .risk import (
    Position,
    SECTOR_RISK,
    decompose,
    marginal_contribution,
    max_weight_under_vol,
    positions_from_holdings,
    risk_inputs,
    value_at_risk,
)

# Same thresholds as the concentration flags in portfolio.py.
SINGLE_STOCK_FLAG = 0.2
SECTOR_FLAG = 0.35

# Annualized portfolio volatility each risk profile is willing to carry. These
# are the ceilings the "max position size" answer is solved against.
VOL_CEILING: Dict[str, float] = {
    "conservative": 0.09,
    "balanced": 0.13,
    "growth": 0.18,
    "aggressive": 0.25,
}


def _candidate_position(
    forecast: StockForecast, weight: float
) -> Position:
    """The analyzed stock as a risk-model position.

    Volatility is the engine's fitted sigma (measured from real returns when
    history was available). Beta prefers the reported company beta and falls
    back to the sector assumption.
    """
    beta = None
    if forecast.fundamentals is not None:
        beta = forecast.fundamentals.beta
    if beta is None or beta <= 0:
        beta = SECTOR_RISK.get(forecast.sector, (1.0, 0.24))[0]
    measured = bool(forecast.inputs and forecast.inputs.vol_measured)
    return Position(
        label=forecast.symbol,
        weight=weight,
        beta=beta,
        vol=forecast.vol,
        measured=measured,
    )


def _annual_expected_return(holdings: List[Holding], total: float) -> float:
    """Weighted annual expected return using the asset-class assumptions."""
    if total <= 0:
        return 0.0
    return sum(
        (float(h.value) / total) * RETURNS.get(h.asset, 0.0) for h in holdings
    )


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
    dilution = total / total_after
    added_weight = added / total_after

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

    # --- Allocation gap ---------------------------------------------------
    name, _ = risk_profile(profile)
    target = TARGETS[name]
    current: Dict[str, float] = {}
    for h in holdings:
        current[h.asset] = current.get(h.asset, 0.0) + float(h.value) / total
    after = {k: w * dilution for k, w in current.items()}
    after["us_equity"] = after.get("us_equity", 0.0) + added_weight

    gap_delta = {}
    for k in sorted(set(current) | set(target) | {"us_equity"}):
        gap_before = target.get(k, 0.0) - current.get(k, 0.0)
        gap_after = target.get(k, 0.0) - after.get(k, 0.0)
        gap_delta[k] = gap_after - gap_before

    # --- Risk effect ------------------------------------------------------
    before_positions = positions_from_holdings(holdings, total)
    risk_before = decompose(before_positions)

    # Post-trade weights: everything existing dilutes, the candidate is added.
    # An existing position in the same symbol stays separate rather than being
    # merged, which keeps its measured vol from being overwritten; the risk
    # model sums their contributions correctly either way.
    after_positions = [
        Position(p.label, p.weight * dilution, p.beta, p.vol, p.measured)
        for p in before_positions
    ]
    candidate = _candidate_position(forecast, added_weight)
    after_positions.append(candidate)
    risk_after = decompose(after_positions)

    candidate_index = len(after_positions) - 1
    mcr = marginal_contribution(after_positions, candidate_index)
    risk_contribution = (
        (candidate.weight * mcr) / risk_after.volatility
        if risk_after.volatility > 0
        else 0.0
    )

    horizon_years = max(forecast.days, 1.0) / 365.0
    var_before = value_at_risk(risk_before.volatility, horizon_years)
    var_after = value_at_risk(risk_after.volatility, horizon_years)

    # --- Expected return --------------------------------------------------
    annual_before = _annual_expected_return(holdings, total)
    stock_mu = forecast.inputs.mu if forecast.inputs else forecast.expected / horizon_years
    annual_after = annual_before * dilution + stock_mu * added_weight
    expected_before = annual_before * horizon_years
    expected_after = annual_after * horizon_years

    # Return per unit of risk, before vs after. The honest test of whether the
    # position earns its place rather than just adding exposure.
    ratio_before = annual_before / risk_before.volatility if risk_before.volatility > 0 else 0.0
    ratio_after = annual_after / risk_after.volatility if risk_after.volatility > 0 else 0.0

    ceiling = VOL_CEILING.get(name, 0.15)
    max_weight = max_weight_under_vol(before_positions, candidate, ceiling)

    # --- Risk attribution table ------------------------------------------
    contributors: List[RiskContribution] = []
    if risk_after.volatility > 0:
        for i, p in enumerate(after_positions):
            share = (p.weight * marginal_contribution(after_positions, i)) / risk_after.volatility
            contributors.append(
                RiskContribution(
                    label=p.label,
                    weight=p.weight,
                    volatility=p.vol,
                    beta=p.beta,
                    risk_contribution=share,
                )
            )
        contributors.sort(key=lambda c: c.risk_contribution, reverse=True)

    return PortfolioImpact(
        added_value=added,
        new_weight=new_weight,
        sector=forecast.sector,
        sector_weight_after=sector_weight_after,
        triggers_single_stock_flag=new_weight > SINGLE_STOCK_FLAG,
        triggers_sector_flag=sector_weight_after > SECTOR_FLAG,
        gap_delta=gap_delta,
        vol_before=risk_before.volatility,
        vol_after=risk_after.volatility,
        vol_delta=risk_after.volatility - risk_before.volatility,
        beta_before=risk_before.beta,
        beta_after=risk_after.beta,
        risk_contribution=risk_contribution,
        diversification_before=risk_before.diversification_ratio,
        diversification_after=risk_after.diversification_ratio,
        effective_positions_before=risk_before.effective_positions,
        effective_positions_after=risk_after.effective_positions,
        var95_before=var_before,
        var95_after=var_after,
        expected_return_before=expected_before,
        expected_return_after=expected_after,
        max_weight_for_profile=max_weight,
        vol_ceiling=ceiling,
        improves_risk_adjusted_return=ratio_after > ratio_before,
        top_risk_contributors=contributors[:6],
    )
