"""The advisor — natural-language answers over deterministic context.

Mirror of frontend/src/lib/ai/advisor.ts. This is the module the LLM provider
routing replaces in the production build. Educational framing only — never
buy/sell advice.
"""
from __future__ import annotations

from ...schemas import (
    AdvisorScenarioContext,
    AdvisorSourceContext,
    PortfolioAnalysis,
    StockForecast,
)
from .format import currency, pct, title_case
from .insights import describe_concentrations, describe_recommendations


def answer_advisor(
    question: str,
    analysis: PortfolioAnalysis,
    stock: StockForecast,
    scenario: AdvisorScenarioContext | None = None,
    source_context: AdvisorSourceContext | None = None,
) -> str:
    low = question.lower()

    if scenario is not None and any(
        term in low for term in ("goal", "probability", "chance", "monte", "simulation", "percentile")
    ):
        return (
            f"Across {scenario.paths:,} assumption-driven paths, this plan reached "
            f"{currency(scenario.goal_value)} by year {scenario.horizon_years} in "
            f"{pct(scenario.success_probability)} of simulations. The modeled terminal "
            f"median is {currency(scenario.p50)}, with a 10th–90th percentile range of "
            f"{currency(scenario.p10)} to {currency(scenario.p90)}. Increasing contributions "
            "or lowering the target can improve that probability without assuming higher returns."
        )

    if (
        source_context is not None
        and source_context.kind in ("allocation_gap", "rebalance_plan")
        and any(term in low for term in ("rebalance", "allocation", "gap", "close"))
    ):
        return (
            f"{source_context.summary} Direct future contributions toward the underweight "
            "assets first, then reassess before trimming concentrated positions. This lowers "
            "turnover while moving the portfolio toward its target."
        )

    if "stock" in low or "ticker" in low or stock.symbol.lower() in low:
        return (
            f"{stock.symbol} is rated {stock.rating.lower()} in Analyze Stock, "
            f"with median target {currency(stock.median_target)} and expected return "
            f"{pct(stock.expected)}. Check {title_case(stock.sector)} concentration before adding."
        )
    if "rebalance" in low:
        evidence = f"{source_context.summary} " if source_context is not None else ""
        return f"{evidence}Use future contributions first, then trim concentrated holdings if needed."
    if any(term in low for term in ("risk", "volatility", "var", "drawdown")):
        top = analysis.risk.top_contributors[0] if analysis.risk.top_contributors else None
        top_text = (
            f" {top.label} contributes {pct(top.risk_contribution)} of modeled risk at "
            f"{pct(top.weight)} of capital."
            if top
            else ""
        )
        return (
            f"Modeled annual volatility is {pct(analysis.risk.annualized_volatility)}, "
            f"using {pct(analysis.risk.risk_budget_used)} of the "
            f"{pct(analysis.risk.vol_ceiling)} profile budget.{top_text}"
        )
    if "connect" in low:
        return "Connect brokerage sync next so SmartFolio can analyze live holdings."

    flags = describe_concentrations(analysis.concentrations)
    recs = describe_recommendations(analysis.recommendations)
    next_step = recs[0] if recs else "keep monitoring allocation."
    return f"{flags[0]} Suggested next step: {next_step}"
