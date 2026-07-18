"""Pydantic models — the typed API contract.

These mirror the frontend's TypeScript types (frontend/src/types.ts and
frontend/src/lib/calculations/portfolio.ts) field-for-field. The wire format is
camelCase (matching the TS types) via alias generation; Python code uses
snake_case internally.
"""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    """Base model: snake_case in Python, camelCase on the wire."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


RiskProfileName = Literal["conservative", "balanced", "growth", "aggressive"]
StockRating = Literal["Constructive", "Neutral", "Cautious"]


class InvestorProfile(ApiModel):
    age: float
    income: float
    contribution: float
    horizon: float
    risk: float  # tolerance, 1 (low) .. 5 (high)
    emergency: float  # emergency fund, months of expenses
    goal: Literal["long_term_growth", "retirement", "income"]
    liquidity: Literal["low", "medium", "high"]


class Holding(ApiModel):
    symbol: str
    name: str
    type: Literal["stock", "etf", "cash"]
    asset: Literal[
        "us_equity", "intl_equity", "bonds", "cash", "alternatives", "crypto", "other"
    ]
    sector: str
    value: float


class ConcentrationFinding(ApiModel):
    """A structured concentration finding — no prose."""

    kind: Literal["single_stock", "stock_aggregate", "sector"]
    label: str
    weight: float


class RecommendationSignal(ApiModel):
    """A structured recommendation signal — no prose."""

    kind: Literal["increase", "reduce", "diversify_single_stock"]
    asset: Optional[str] = None


class PortfolioAnalysis(ApiModel):
    risk_profile_name: RiskProfileName
    risk_score: float
    current: Dict[str, float]
    target: Dict[str, float]
    gap: Dict[str, float]  # target - current, per asset class
    concentrations: List[ConcentrationFinding]
    recommendations: List[RecommendationSignal]
    value: float
    current_return: float
    target_return: float


class PortfolioInsights(ApiModel):
    """User-facing prose rendered by the AI layer from the structured findings."""

    flags: List[str]
    recommendations: List[str]


class PortfolioAnalyzeRequest(ApiModel):
    profile: InvestorProfile
    holdings: List[Holding]


class PortfolioAnalyzeResponse(ApiModel):
    analysis: PortfolioAnalysis
    insights: PortfolioInsights


class ForecastPoint(ApiModel):
    bear: float
    median: float
    bull: float


class BacktestResult(ApiModel):
    windows: int
    hit: float
    error: float
    drawdown: float


class StockTrace(ApiModel):
    audit: List[str]
    topology: List[str]


class StockForecast(ApiModel):
    """Deterministic output of the stock forecast engine — numbers only."""

    symbol: str
    name: str
    sector: str
    price: float
    days: float
    vol: float
    quality: float
    rating: StockRating
    confidence: float
    median_target: float
    bear_target: float
    bull_target: float
    expected: float  # expected return over the horizon (decimal)
    paths: List[ForecastPoint]
    backtest: BacktestResult
    trace: StockTrace
    # Provenance of the price input: "alphavantage" | "finnhub" | "offline".
    source: str = "offline"
    as_of: Optional[str] = None


class StockAnalyzeRequest(ApiModel):
    ticker: str = "AAPL"
    days: float = 30
    # Optional investor context. When present, the Portfolio Agent runs the
    # what-if impact analysis against these holdings.
    profile: Optional[InvestorProfile] = None
    holdings: Optional[List[Holding]] = None


Narrator = Literal["llm", "template"]


class AgentEvent(ApiModel):
    """One step of the analysis pipeline — a real trace entry, not a fiction."""

    agent: str
    status: Literal["succeeded", "failed", "skipped"]
    duration_ms: float
    detail: str


class PortfolioImpact(ApiModel):
    """Deterministic what-if: adding this stock to the sent portfolio."""

    added_value: float  # proposed position size (round(price * 10))
    new_weight: float  # combined weight of the symbol after adding
    sector: str
    sector_weight_after: float
    triggers_single_stock_flag: bool
    triggers_sector_flag: bool
    # Allocation-gap shift per asset class (gap_after - gap_before).
    gap_delta: Dict[str, float]


class StockAnalyzeResponse(ApiModel):
    forecast: StockForecast
    impact: Optional[PortfolioImpact] = None
    events: List[AgentEvent]
    # Research memo prose (forecast + impact narration). LLM-written when a key
    # is configured and compliance passes; deterministic template otherwise.
    memo: List[str]
    narrator: Narrator


class AdvisorAskRequest(ApiModel):
    question: str
    profile: InvestorProfile
    holdings: List[Holding]
    stock: StockForecast


class AdvisorAskResponse(ApiModel):
    answer: str
    narrator: Narrator = "template"


# --- Workspace persistence (Phase 4 core) ---------------------------------


class WorkspaceCreateResponse(ApiModel):
    id: str


class MemoIn(ApiModel):
    symbol: str
    rating: str
    body: str


class MemoOut(MemoIn):
    id: str
    created_at: str


class WorkspaceState(ApiModel):
    """One-shot hydration payload for the frontend."""

    profile: Optional[InvestorProfile] = None
    holdings: List[Holding] = []
    memos: List[MemoOut] = []


class HoldingsPut(ApiModel):
    holdings: List[Holding]


class AnalysisSummary(ApiModel):
    id: str
    symbol: str
    days: float
    rating: str
    source: str
    created_at: str
