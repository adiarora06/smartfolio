"""REST endpoints.

Each endpoint composes the layers explicitly: deterministic services compute
the numbers/findings, the AI layer narrates them (LLM when configured, template
fallback otherwise), and the Compliance agent validates the narration.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Header, Request

from .db import SessionLocal, save_stock_run
from .orchestrator import run_stock_analysis
from .ratelimit import EXPENSIVE_LIMIT, limiter
from .schemas import (
    AdvisorAskRequest,
    AdvisorAskResponse,
    PortfolioAnalyzeRequest,
    PortfolioAnalyzeResponse,
    PortfolioPerformanceRequest,
    PortfolioPerformanceResponse,
    RebalancePlanRequest,
    RebalancePlanResponse,
    ScenarioLabRequest,
    ScenarioLabResponse,
    StockAnalyzeRequest,
    StockAnalyzeResponse,
)
from .services.ai.advisor import answer_advisor
from .services.ai.insights import describe_insights
from .services.ai.llm import answer_question
from .services.portfolio import analyze_portfolio
from .services.performance import calculate_performance
from .services.rebalance import plan_rebalance
from .services.scenario import run_scenario_lab

router = APIRouter()


@router.post("/portfolio/analyze", response_model=PortfolioAnalyzeResponse)
def portfolio_analyze(req: PortfolioAnalyzeRequest) -> PortfolioAnalyzeResponse:
    """Deterministic portfolio diagnosis + AI-layer prose for the findings."""
    analysis = analyze_portfolio(req.holdings, req.profile)
    return PortfolioAnalyzeResponse(analysis=analysis, insights=describe_insights(analysis))


@router.post("/portfolio/performance", response_model=PortfolioPerformanceResponse)
def portfolio_performance(req: PortfolioPerformanceRequest) -> PortfolioPerformanceResponse:
    """Cash-flow-aware history from explicit workspace valuations."""
    return PortfolioPerformanceResponse(
        performance=calculate_performance(req.transactions, req.valuations, req.range)
    )


@router.post("/portfolio/rebalance", response_model=RebalancePlanResponse)
def portfolio_rebalance(req: RebalancePlanRequest) -> RebalancePlanResponse:
    """Preview exact-cent dollar actions; never execute or persist trades."""
    return plan_rebalance(req)


@router.post("/portfolio/scenario-lab", response_model=ScenarioLabResponse)
def portfolio_scenario_lab(req: ScenarioLabRequest) -> ScenarioLabResponse:
    """Calculate the entire interactive strategy lab in one backend request."""
    analysis = analyze_portfolio(req.holdings, req.profile)
    return run_scenario_lab(analysis, req)


async def _persist_run(workspace_id: str, resp: StockAnalyzeResponse) -> None:
    """Background persistence with its own session (runs after the response)."""
    async with SessionLocal() as session:
        await save_stock_run(session, workspace_id, resp)


@router.post("/stocks/analyze", response_model=StockAnalyzeResponse)
@limiter.limit(EXPENSIVE_LIMIT)
async def stocks_analyze(
    request: Request,
    req: StockAnalyzeRequest,
    background: BackgroundTasks,
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
) -> StockAnalyzeResponse:
    """Full pipeline run: forecast + what-if impact + real agent trace + memo.

    When an X-Workspace-Id header is present, the run is persisted so it shows
    up in the workspace's analysis history. Replaying it with GET
    /analyses/{id} requires the same workspace header. Persistence is a
    background task — the client never waits on the DB write.
    """
    resp = await run_stock_analysis(req)
    if x_workspace_id:
        background.add_task(_persist_run, x_workspace_id, resp)
    return resp


@router.post("/advisor/ask", response_model=AdvisorAskResponse)
@limiter.limit(EXPENSIVE_LIMIT)
async def advisor_ask(request: Request, req: AdvisorAskRequest) -> AdvisorAskResponse:
    """Advisor answer grounded in a fresh deterministic analysis of the sent state."""
    analysis = analyze_portfolio(req.holdings, req.profile)
    template = answer_advisor(
        req.question, analysis, req.stock, req.scenario, req.source_context
    )
    answer, narrator = await answer_question(
        req.question,
        analysis,
        req.stock,
        template,
        req.scenario,
        req.source_context,
    )
    return AdvisorAskResponse(answer=answer, narrator=narrator)
