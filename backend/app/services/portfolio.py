"""Deterministic portfolio analytics.

Math only — returns numbers and structured findings, never prose. The prose
lives in services/ai (the explanation layer), and this Python service is the
canonical portfolio model used by the API.
"""
from __future__ import annotations

from typing import Dict, List, Tuple

from ..schemas import (
    ConcentrationFinding,
    Holding,
    InvestorProfile,
    PortfolioAnalysis,
    PortfolioRiskSnapshot,
    PortfolioStressTest,
    RecommendationSignal,
    RiskContribution,
)
from .data import RETURNS, TARGETS
from .risk import (
    ASSET_RISK,
    VOL_CEILING,
    Position,
    conditional_value_at_risk,
    decompose,
    marginal_contribution,
    positions_from_holdings,
    risk_inputs,
    value_at_risk,
)

EQUITY_ASSETS = ("us_equity", "intl_equity")
LIQUIDITY_DRAG = {"low": 0.0, "medium": 0.12, "high": 0.25}


def portfolio_value(holdings: List[Holding]) -> float:
    return sum(float(h.value or 0) for h in holdings)


def allocation(holdings: List[Holding]) -> Dict[str, float]:
    total = portfolio_value(holdings)
    out: Dict[str, float] = {}
    if not total:
        return out
    for h in holdings:
        out[h.asset] = out.get(h.asset, 0.0) + float(h.value) / total
    return out


def sector_allocation(holdings: List[Holding]) -> Dict[str, float]:
    total = portfolio_value(holdings)
    out: Dict[str, float] = {}
    if not total:
        return out
    for h in holdings:
        if h.asset in EQUITY_ASSETS:
            out[h.sector] = out.get(h.sector, 0.0) + float(h.value) / total
    return out


def risk_profile(profile: InvestorProfile) -> Tuple[str, float]:
    """Score risk tolerance + capacity into (profile_name, raw_score)."""
    liq = LIQUIDITY_DRAG.get(profile.liquidity, 0.12)
    cap = max(
        0.0,
        min(
            1.0,
            0.45 * (profile.horizon / 30)
            + 0.3 * ((70 - profile.age) / 50)
            + 0.25 * (profile.emergency / 6)
            - liq,
        ),
    )
    score = 0.55 * ((profile.risk - 1) / 4) + 0.45 * cap
    name = (
        "conservative"
        if score < 0.3
        else "balanced" if score < 0.55 else "growth" if score < 0.78 else "aggressive"
    )
    return name, score


def _stress_return(holding: Holding, scenario: str) -> float:
    """Deterministic scenario shock for one holding.

    These are explicit educational assumptions, not forecasts. They live in
    the calculation layer so the UI and AI only report the computed result.
    """
    beta, _ = risk_inputs(holding)
    is_equity = holding.asset in EQUITY_ASSETS
    if scenario == "market_selloff":
        if holding.asset == "cash":
            return 0.0
        return max(-0.65, -0.20 * beta)
    if scenario == "technology_shock":
        if is_equity and holding.sector == "technology":
            return -0.25
        if is_equity:
            return -0.03 * beta
        if holding.asset == "alternatives":
            return -0.03
        return 0.0
    if holding.asset == "bonds":
        return -0.08
    if holding.asset == "cash":
        return 0.0
    if is_equity and holding.sector == "real_estate":
        return -0.12
    if is_equity:
        return -0.05 * beta
    return -0.04 if holding.asset == "alternatives" else 0.0


def _risk_snapshot(
    holdings: List[Holding], profile_name: str, current_return: float, total: float
) -> PortfolioRiskSnapshot:
    positions = positions_from_holdings(holdings, total)
    decomposition = decompose(positions)
    total_variance = decomposition.volatility**2

    contributors: List[RiskContribution] = []
    if decomposition.volatility > 0:
        for index, position in enumerate(positions):
            share = position.weight * marginal_contribution(positions, index)
            share /= decomposition.volatility
            contributors.append(
                RiskContribution(
                    label=position.label,
                    weight=position.weight,
                    volatility=position.vol,
                    beta=position.beta,
                    risk_contribution=max(0.0, share),
                )
            )
    contributors.sort(key=lambda item: item.risk_contribution, reverse=True)

    target_positions = [
        Position(asset, weight, *ASSET_RISK.get(asset, ASSET_RISK["other"]))
        for asset, weight in TARGETS[profile_name].items()
        if weight > 0
    ]
    target_volatility = decompose(target_positions).volatility
    ceiling = VOL_CEILING.get(profile_name, 0.15)
    one_month = 1.0 / 12.0

    stress_tests = []
    for scenario in ("market_selloff", "technology_shock", "rate_shock"):
        estimated_return = (
            sum(
                (float(holding.value) / total) * _stress_return(holding, scenario)
                for holding in holdings
            )
            if total > 0
            else 0.0
        )
        stress_tests.append(
            PortfolioStressTest(
                scenario=scenario,  # type: ignore[arg-type]
                estimated_return=estimated_return,
                dollar_impact=total * estimated_return,
            )
        )

    return PortfolioRiskSnapshot(
        annualized_volatility=decomposition.volatility,
        target_volatility=target_volatility,
        beta=decomposition.beta,
        systematic_share=(decomposition.systematic**2 / total_variance)
        if total_variance > 0
        else 0.0,
        idiosyncratic_share=(decomposition.idiosyncratic**2 / total_variance)
        if total_variance > 0
        else 0.0,
        diversification_ratio=decomposition.diversification_ratio,
        effective_positions=decomposition.effective_positions,
        vol_ceiling=ceiling,
        risk_budget_used=decomposition.volatility / ceiling if ceiling > 0 else 0.0,
        var95_one_month=value_at_risk(decomposition.volatility, one_month),
        cvar95_one_month=conditional_value_at_risk(
            decomposition.volatility, one_month
        ),
        return_to_risk=current_return / decomposition.volatility
        if decomposition.volatility > 0
        else 0.0,
        top_contributors=contributors[:6],
        stress_tests=stress_tests,
    )


def analyze_portfolio(holdings: List[Holding], profile: InvestorProfile) -> PortfolioAnalysis:
    """Full deterministic portfolio diagnosis with structured findings."""
    name, score = risk_profile(profile)
    current = allocation(holdings)
    target = TARGETS[name]

    gap = {k: target.get(k, 0.0) - current.get(k, 0.0) for k in sorted(set(current) | set(target))}

    total = portfolio_value(holdings) or 1.0
    sectors = sector_allocation(holdings)
    stocks = [h for h in holdings if h.type == "stock"]

    concentrations: List[ConcentrationFinding] = []
    for h in stocks:
        w = float(h.value) / total
        if w > 0.2:
            concentrations.append(ConcentrationFinding(kind="single_stock", label=h.symbol, weight=w))
    stock_weight = sum(float(h.value) for h in stocks) / total
    if stock_weight > 0.5:
        concentrations.append(
            ConcentrationFinding(kind="stock_aggregate", label="stocks", weight=stock_weight)
        )
    for sector, w in sectors.items():
        if w > 0.35:
            concentrations.append(ConcentrationFinding(kind="sector", label=sector, weight=w))

    recommendations: List[RecommendationSignal] = []
    for asset, d in gap.items():
        if d > 0.08:
            recommendations.append(RecommendationSignal(kind="increase", asset=asset))
        if d < -0.08:
            recommendations.append(RecommendationSignal(kind="reduce", asset=asset))
    if any(c.kind == "single_stock" for c in concentrations):
        recommendations.append(RecommendationSignal(kind="diversify_single_stock"))

    current_return = sum(w * RETURNS.get(k, 0.0) for k, w in current.items())
    target_return = sum(w * RETURNS.get(k, 0.0) for k, w in target.items())

    return PortfolioAnalysis(
        risk_profile_name=name,
        risk_score=score,
        current=current,
        target=target,
        gap=gap,
        concentrations=concentrations,
        recommendations=recommendations,
        value=portfolio_value(holdings),
        current_return=current_return,
        target_return=target_return,
        risk=_risk_snapshot(holdings, name, current_return, portfolio_value(holdings)),
    )
