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
    ContributionOptimizationInputs,
    ContributionOptimizeRequest,
    ContributionOptimizeResponse,
    PortfolioAnalyzeRequest,
    PortfolioAnalyzeResponse,
    PortfolioPerformanceRequest,
    PortfolioPerformanceResponse,
    PortfolioSimulateRequest,
    PortfolioSimulateResponse,
    ScenarioSimulationInputs,
    StockAnalyzeRequest,
    StockAnalyzeResponse,
)
from .services.ai.advisor import answer_advisor
from .services.ai.insights import describe_insights
from .services.ai.llm import answer_question
from .services.portfolio import analyze_portfolio
from .services.performance import calculate_performance
from .services.scenario import optimize_contribution, simulate_strategy

router = APIRouter()


@router.post("/portfolio/analyze", response_model=PortfolioAnalyzeResponse)
def portfolio_analyze(req: PortfolioAnalyzeRequest) -> PortfolioAnalyzeResponse:
    """Deterministic portfolio diagnosis + AI-layer prose for the findings."""
    analysis = analyze_portfolio(req.holdings, req.profile)
    return PortfolioAnalyzeResponse(analysis=analysis, insights=describe_insights(analysis))


@router.post("/portfolio/performance", response_model=PortfolioPerformanceResponse)
def portfolio_performance(req: PortfolioPerformanceRequest) -> PortfolioPerformanceResponse:
    """Cash-flow-adjusted performance from explicit workspace valuations."""
    return PortfolioPerformanceResponse(
        performance=calculate_performance(req.transactions, req.valuations)
    )


@router.post("/portfolio/simulate", response_model=PortfolioSimulateResponse)
def portfolio_simulate(req: PortfolioSimulateRequest) -> PortfolioSimulateResponse:
    """Seeded strategy distribution using the same canonical portfolio model."""
    analysis = analyze_portfolio(req.holdings, req.profile)
    inputs = ScenarioSimulationInputs(
        contribution=req.contribution,
        return_adj=req.return_adj,
        rebalance=req.rebalance,
        goal_value=req.goal_value,
        horizon_years=req.horizon_years,
        paths=req.paths,
        seed=req.seed,
    )
    return PortfolioSimulateResponse(simulation=simulate_strategy(analysis, inputs))


@router.post(
    "/portfolio/optimize-contribution", response_model=ContributionOptimizeResponse
)
def contribution_optimize(req: ContributionOptimizeRequest) -> ContributionOptimizeResponse:
    """Reverse-solve a monthly contribution for the requested goal confidence."""
    analysis = analyze_portfolio(req.holdings, req.profile)
    inputs = ContributionOptimizationInputs(
        return_adj=req.return_adj,
        rebalance=req.rebalance,
        goal_value=req.goal_value,
        target_probability=req.target_probability,
        horizon_years=req.horizon_years,
        paths=req.paths,
        seed=req.seed,
        max_contribution=req.max_contribution,
        contribution_step=req.contribution_step,
    )
    return ContributionOptimizeResponse(
        optimization=optimize_contribution(analysis, inputs)
    )


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
