"""Portfolio insights — phrases the structured findings as sentences.

Mirror of frontend/src/lib/ai/insights.ts.
"""
from __future__ import annotations

from typing import List

from ...schemas import (
    ConcentrationFinding,
    PortfolioAnalysis,
    PortfolioInsights,
    RecommendationSignal,
)
from .format import pct, title_case


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


def describe_insights(analysis: PortfolioAnalysis) -> PortfolioInsights:
    return PortfolioInsights(
        flags=describe_concentrations(analysis.concentrations),
        recommendations=describe_recommendations(analysis.recommendations),
    )
