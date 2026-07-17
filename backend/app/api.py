"""REST endpoints.

Each endpoint composes the two layers explicitly: deterministic services
compute the numbers/findings, the AI layer phrases them. The roadmap's
`POST /profiles` and `GET /analyses/{id}` arrive with persistence (Phase 4).
"""
from __future__ import annotations

from fastapi import APIRouter

from .schemas import (
    AdvisorAskRequest,
    AdvisorAskResponse,
    PortfolioAnalyzeRequest,
    PortfolioAnalyzeResponse,
    StockAnalyzeRequest,
    StockForecast,
)
from .marketdata.resolver import resolver
from .services.ai.advisor import answer_advisor
from .services.ai.insights import describe_insights
from .services.portfolio import analyze_portfolio
from .services.stock import analyze_stock

router = APIRouter()


@router.post("/portfolio/analyze", response_model=PortfolioAnalyzeResponse)
def portfolio_analyze(req: PortfolioAnalyzeRequest) -> PortfolioAnalyzeResponse:
    """Deterministic portfolio diagnosis + AI-layer prose for the findings."""
    analysis = analyze_portfolio(req.holdings, req.profile)
    return PortfolioAnalyzeResponse(analysis=analysis, insights=describe_insights(analysis))


@router.post("/stocks/analyze", response_model=StockForecast)
async def stocks_analyze(req: StockAnalyzeRequest) -> StockForecast:
    """Deterministic OpenVC-style forecast run for a ticker + horizon.

    Resolves the live price first (offline reference when no key/network), then
    runs the unchanged deterministic engine over it.
    """
    snapshot = await resolver.resolve(req.ticker)
    return analyze_stock(req.ticker, req.days, snapshot)


@router.post("/advisor/ask", response_model=AdvisorAskResponse)
def advisor_ask(req: AdvisorAskRequest) -> AdvisorAskResponse:
    """Advisor answer grounded in a fresh deterministic analysis of the sent state."""
    analysis = analyze_portfolio(req.holdings, req.profile)
    return AdvisorAskResponse(answer=answer_advisor(req.question, analysis, req.stock))
