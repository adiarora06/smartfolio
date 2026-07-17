"""Deterministic portfolio analytics.

Math only — returns numbers and structured findings, never prose. The prose
lives in services/ai (the explanation layer). This is the same boundary as the
frontend's lib/calculations vs lib/ai split, and the formulas are a 1:1 port of
frontend/src/lib/calculations/portfolio.ts.
"""
from __future__ import annotations

from typing import Dict, List, Tuple

from ..schemas import (
    ConcentrationFinding,
    Holding,
    InvestorProfile,
    PortfolioAnalysis,
    RecommendationSignal,
)
from .data import RETURNS, TARGETS

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
    )
