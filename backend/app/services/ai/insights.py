"""Portfolio insights — phrases the structured findings as sentences.

Mirror of frontend/src/lib/ai/insights.ts.
"""
from __future__ import annotations

from typing import List

from ...schemas import (
    ConcentrationFinding,
    PortfolioAnalysis,
    PortfolioImpact,
    PortfolioInsights,
    RecommendationSignal,
)
from .format import currency, pct, title_case


def describe_concentrations(findings: List[ConcentrationFinding]) -> List[str]:
    if not findings:
        return ["No major concentration flags found."]
    out: List[str] = []
    for f in findings:
        if f.kind == "single_stock":
            out.append(
                f"{f.label} is {pct(f.weight)} of the portfolio, a high single-stock concentration."
            )
        elif f.kind == "stock_aggregate":
            out.append(f"Individual stocks are {pct(f.weight)} of the portfolio.")
        else:
            out.append(
                f"{title_case(f.label)} exposure is {pct(f.weight)}, creating sector concentration risk."
            )
    return out


def describe_recommendations(signals: List[RecommendationSignal]) -> List[str]:
    out: List[str] = []
    for s in signals:
        if s.kind == "increase":
            out.append(f"Increase {(s.asset or '').replace('_', ' ')} exposure over time.")
        elif s.kind == "reduce":
            out.append(f"Reduce {(s.asset or '').replace('_', ' ')} concentration over time.")
        else:
            out.append("Use broader funds or future contributions to reduce single-stock dependency.")
    return out


def describe_impact(impact: PortfolioImpact, symbol: str) -> List[str]:
    """Phrase the what-if impact findings. Mirrored in frontend lib/ai/insights.ts."""
    first = (
        f"Adding {currency(impact.added_value)} of {symbol} would make it "
        f"{pct(impact.new_weight)} of your portfolio"
    )
    first += (
        ", triggering a single-stock concentration flag."
        if impact.triggers_single_stock_flag
        else "."
    )
    second = (
        f"{title_case(impact.sector)} exposure would move to "
        f"{pct(impact.sector_weight_after)}"
    )
    second += (
        ", crossing the sector concentration threshold."
        if impact.triggers_sector_flag
        else "."
    )
    out = [first, second]

    if impact.vol_after > 0:
        direction = "up" if impact.vol_delta > 0 else "down"
        out.append(
            f"Estimated portfolio volatility moves {direction} from "
            f"{pct(impact.vol_before)} to {pct(impact.vol_after)} annualized, "
            f"and portfolio beta from {impact.beta_before:.2f} to {impact.beta_after:.2f}."
        )
        # The weight/risk gap is the finding a weights-only view cannot show.
        if impact.risk_contribution > impact.new_weight * 1.25:
            out.append(
                f"At {pct(impact.new_weight)} of value the position would carry "
                f"{pct(impact.risk_contribution)} of total portfolio risk — its "
                f"volatility makes it a larger risk position than a weight view suggests."
            )
        out.append(
            f"A 95% confidence loss estimate over the same horizon moves from "
            f"{pct(impact.var95_before)} to {pct(impact.var95_after)} of portfolio value."
        )
        if impact.max_weight_for_profile > 0:
            out.append(
                f"Staying inside the {pct(impact.vol_ceiling)} volatility ceiling for this "
                f"risk profile implies a position of at most "
                f"{pct(impact.max_weight_for_profile)} of the portfolio."
            )
        out.append(
            "Return per unit of risk improves on these assumptions."
            if impact.improves_risk_adjusted_return
            else "Return per unit of risk does not improve on these assumptions."
        )
    return out


def describe_insights(analysis: PortfolioAnalysis) -> PortfolioInsights:
    return PortfolioInsights(
        flags=describe_concentrations(analysis.concentrations),
        recommendations=describe_recommendations(analysis.recommendations),
    )
