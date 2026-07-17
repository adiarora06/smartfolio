"""The advisor — natural-language answers over deterministic context.

Mirror of frontend/src/lib/ai/advisor.ts. This is the module the LLM provider
routing replaces in the production build. Educational framing only — never
buy/sell advice.
"""
from __future__ import annotations

from ...schemas import PortfolioAnalysis, StockForecast
from .format import currency, pct, title_case
from .insights import describe_concentrations, describe_recommendations


def answer_advisor(question: str, analysis: PortfolioAnalysis, stock: StockForecast) -> str:
    low = question.lower()

    if "stock" in low or "ticker" in low or stock.symbol.lower() in low:
        return (
            f"{stock.symbol} is rated {stock.rating.lower()} in Analyze Stock, "
            f"with median target {currency(stock.median_target)} and expected return "
            f"{pct(stock.expected)}. Check {title_case(stock.sector)} concentration before adding."
        )
    if "rebalance" in low:
        return "Use future contributions first, then trim concentrated holdings if needed."
    if "connect" in low:
        return "Connect brokerage sync next so SmartFolio can analyze live holdings."

    flags = describe_concentrations(analysis.concentrations)
    recs = describe_recommendations(analysis.recommendations)
    next_step = recs[0] if recs else "keep monitoring allocation."
    return f"{flags[0]} Suggested next step: {next_step}"
