"""REST endpoints.

Each endpoint composes the layers explicitly: deterministic services compute
the numbers/findings, the AI layer narrates them (LLM when configured, template
fallback otherwise), and the Compliance agent validates the narration.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_session, save_stock_run
from .orchestrator import run_stock_analysis
from .schemas import (
    AdvisorAskRequest,
    AdvisorAskResponse,
    PortfolioAnalyzeRequest,
    PortfolioAnalyzeResponse,
    StockAnalyzeRequest,
    StockAnalyzeResponse,
)
from .services.ai.advisor import answer_advisor
from .services.ai.insights import describe_insights
from .services.ai.llm import answer_question
from .services.portfolio import analyze_portfolio

router = APIRouter()


@router.post("/portfolio/analyze", response_model=PortfolioAnalyzeResponse)
def portfolio_analyze(req: PortfolioAnalyzeRequest) -> PortfolioAnalyzeResponse:
    """Deterministic portfolio diagnosis + AI-layer prose for the findings."""
    analysis = analyze_portfolio(req.holdings, req.profile)
    return PortfolioAnalyzeResponse(analysis=analysis, insights=describe_insights(analysis))


@router.post("/stocks/analyze", response_model=StockAnalyzeResponse)
async def stocks_analyze(
    req: StockAnalyzeRequest,
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    session: AsyncSession = Depends(get_session),
) -> StockAnalyzeResponse:
    """Full pipeline run: forecast + what-if impact + real agent trace + memo.

    When an X-Workspace-Id header is present, the run is persisted so it shows
    up in the workspace's analysis history (GET /analyses/{id}).
    """
    resp = await run_stock_analysis(req)
    if x_workspace_id:
        await save_stock_run(session, x_workspace_id, resp)
    return resp


@router.post("/advisor/ask", response_model=AdvisorAskResponse)
async def advisor_ask(req: AdvisorAskRequest) -> AdvisorAskResponse:
    """Advisor answer grounded in a fresh deterministic analysis of the sent state."""
    analysis = analyze_portfolio(req.holdings, req.profile)
    template = answer_advisor(req.question, analysis, req.stock)
    answer, narrator = await answer_question(req.question, analysis, req.stock, template)
    return AdvisorAskResponse(answer=answer, narrator=narrator)
