"""Pydantic models — the typed API contract.

These mirror the frontend's TypeScript types (frontend/src/types.ts and
frontend/src/lib/calculations/portfolio.ts) field-for-field. The wire format is
camelCase (matching the TS types) via alias generation; Python code uses
snake_case internally.
"""
from __future__ import annotations

import math
from datetime import date as calendar_date
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    """Base model: snake_case in Python, camelCase on the wire."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


RiskProfileName = Literal["conservative", "balanced", "growth", "aggressive"]
StockRating = Literal["Constructive", "Neutral", "Cautious"]
AssetClass = Literal[
    "us_equity",
    "intl_equity",
    "bonds",
    "cash",
    "alternatives",
    "crypto",
    "other",
]


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
    symbol: str = Field(max_length=16)
    name: str = Field(max_length=128)
    type: Literal["stock", "etf", "cash"]
    asset: AssetClass
    sector: str = Field(max_length=64)
    value: float = Field(ge=0, le=1e12)


TransactionType = Literal[
    "deposit", "withdrawal", "buy", "sell", "dividend", "fee"
]
PortfolioDataSource = Literal["demo", "imported", "manual"]


def _validate_calendar_date(value: str) -> str:
    """Reject impossible dates that still match the YYYY-MM-DD wire shape."""

    try:
        calendar_date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("must be a valid calendar date in YYYY-MM-DD format") from exc
    return value


class PortfolioTransaction(ApiModel):
    """One dated portfolio activity stored in the workspace ledger."""

    id: str = Field(max_length=64)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    type: TransactionType
    symbol: Optional[str] = Field(default=None, max_length=16)
    quantity: Optional[float] = Field(default=None, ge=0, le=1e12)
    price: Optional[float] = Field(default=None, ge=0, le=1e12)
    amount: float = Field(ge=0, le=1e12)
    description: str = Field(default="", max_length=160)
    source: PortfolioDataSource = "manual"

    _valid_date = field_validator("date")(_validate_calendar_date)


class ValuationSnapshot(ApiModel):
    """An explicit dated portfolio value and optional benchmark observation."""

    id: str = Field(max_length=64)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    value: float = Field(ge=0, le=1e13)
    benchmark_symbol: str = Field(default="VOO", max_length=16)
    benchmark_value: Optional[float] = Field(default=None, gt=0, le=1e12)
    source: PortfolioDataSource = "manual"

    _valid_date = field_validator("date")(_validate_calendar_date)


PerformanceRangePreset = Literal["1m", "3m", "6m", "ytd", "1y", "all", "custom"]


class PerformanceRange(ApiModel):
    preset: PerformanceRangePreset = "all"
    start_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")

    @field_validator("start_date", "end_date")
    @classmethod
    def validate_optional_date(cls, value: Optional[str]) -> Optional[str]:
        return _validate_calendar_date(value) if value is not None else None

    @model_validator(mode="after")
    def validate_custom_range(self) -> "PerformanceRange":
        if self.preset == "custom" and (self.start_date is None or self.end_date is None):
            raise ValueError("custom ranges require startDate and endDate")
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValueError("startDate must be on or before endDate")
        return self


class PerformanceRequestedRange(ApiModel):
    preset: PerformanceRangePreset
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class PerformanceEffectiveRange(ApiModel):
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    day_count: int = Field(default=0, ge=0)


class PerformanceInterval(ApiModel):
    start_date: str
    end_date: str
    day_count: int = Field(gt=0)
    external_flow: float
    weighted_external_flow: float
    return_value: Optional[float] = None
    valid: bool


class PerformanceCoverage(ApiModel):
    calculation_status: Literal["unavailable", "partial", "complete"]
    valuation_points: int = Field(ge=0)
    interval_count: int = Field(ge=0)
    valid_interval_count: int = Field(ge=0)
    external_flow_count: int = Field(ge=0)
    median_valuation_gap_days: Optional[float] = Field(default=None, ge=0)
    ledger_completeness: Literal["unknown"] = "unknown"
    benchmark_summary: Literal["none", "complete"]
    benchmark_series: Literal["none", "partial", "complete"]
    drawdown: Literal["snapshot_only"] = "snapshot_only"
    allocation_history: Literal["none"] = "none"
    attribution: Literal["none"] = "none"


class PerformanceWarning(ApiModel):
    code: str
    message: str
    dates: List[str] = Field(default_factory=list)


class PerformancePoint(ApiModel):
    date: str
    value: float
    cumulative_contributions: float
    portfolio_index: Optional[float]
    benchmark_index: Optional[float] = None
    external_flow: float = 0.0
    period_return: Optional[float] = None
    drawdown: Optional[float] = None


class PerformanceSummary(ApiModel):
    measured: bool
    benchmark_symbol: str
    start_date: Optional[str]
    end_date: Optional[str]
    current_value: float
    net_contributions: float
    # Compatibility fields retained for existing clients. They mirror the
    # canonical range metrics and are null when that calculation is unavailable.
    gain: Optional[float]
    total_return: Optional[float]
    benchmark_return: Optional[float]
    excess_return: Optional[float]
    max_drawdown: Optional[float]
    observations: int
    source: Literal["demo", "imported", "manual", "mixed"]
    points: List[PerformancePoint]
    method: Literal["modified_dietz"] = "modified_dietz"
    precision: Literal["estimated"] = "estimated"
    flow_timing_assumption: Literal["date_weighted_end_of_day"] = (
        "date_weighted_end_of_day"
    )
    requested_range: PerformanceRequestedRange
    effective_range: PerformanceEffectiveRange
    estimated_return: Optional[float] = None
    annualized_return: Optional[float] = None
    net_external_flow: float = 0.0
    investment_gain: Optional[float] = None
    current_drawdown: Optional[float] = None
    coverage: PerformanceCoverage
    intervals: List[PerformanceInterval] = Field(default_factory=list)
    warnings: List[PerformanceWarning] = Field(default_factory=list)


class PortfolioPerformanceRequest(ApiModel):
    transactions: List[PortfolioTransaction] = Field(max_length=5000)
    valuations: List[ValuationSnapshot] = Field(max_length=2000)
    range: PerformanceRange = Field(default_factory=PerformanceRange)


class PortfolioPerformanceResponse(ApiModel):
    performance: PerformanceSummary


class ConcentrationFinding(ApiModel):
    """A structured concentration finding — no prose."""

    kind: Literal["single_stock", "stock_aggregate", "sector"]
    label: str
    weight: float


class RecommendationSignal(ApiModel):
    """A structured recommendation signal — no prose."""

    kind: Literal["increase", "reduce", "diversify_single_stock"]
    asset: Optional[str] = None


class RiskContribution(ApiModel):
    """A holding's share of total portfolio risk, not merely capital."""

    label: str
    weight: float
    volatility: float
    beta: float
    risk_contribution: float


class PortfolioStressTest(ApiModel):
    """One deterministic shock applied to the current portfolio."""

    scenario: Literal["market_selloff", "technology_shock", "rate_shock"]
    estimated_return: float
    dollar_impact: float


class PortfolioRiskSnapshot(ApiModel):
    """Whole-portfolio risk decomposition used across the product."""

    annualized_volatility: float
    target_volatility: float
    beta: float
    systematic_share: float
    idiosyncratic_share: float
    diversification_ratio: float
    effective_positions: float
    vol_ceiling: float
    risk_budget_used: float
    var95_one_month: float
    cvar95_one_month: float
    return_to_risk: float
    top_contributors: List[RiskContribution]
    stress_tests: List[PortfolioStressTest]
    assumption_driven: bool = True


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
    risk: PortfolioRiskSnapshot


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


RebalanceMode = Literal["rebalance", "new_money_only"]
RebalanceAction = Literal["buy", "sell"]
RebalanceTargetSource = Literal["risk_profile", "custom"]


class RebalancePlanRequest(ApiModel):
    """Inputs for a deterministic, preview-only dollar rebalancing plan.

    The target can be supplied directly, selected by named risk profile, or
    derived from ``profile``. A named/custom target overrides ``profile`` so a
    client can keep sending the investor context while previewing alternatives.
    """

    holdings: List[Holding] = Field(max_length=200)
    profile: Optional[InvestorProfile] = None
    target_profile: Optional[RiskProfileName] = None
    target_allocation: Optional[Dict[AssetClass, float]] = None
    mode: RebalanceMode = "rebalance"
    contribution_amount: float = Field(default=0.0, ge=0, le=1e12)
    min_trade_amount: float = Field(default=0.0, ge=0, le=1e12)
    # This endpoint never executes or persists trades. Requiring true makes a
    # future execution endpoint an explicit, separately reviewed contract.
    preview_only: Literal[True] = True

    @model_validator(mode="after")
    def validate_target(self) -> "RebalancePlanRequest":
        if self.target_profile is not None and self.target_allocation is not None:
            raise ValueError("Use targetProfile or targetAllocation, not both")
        if (
            self.profile is None
            and self.target_profile is None
            and self.target_allocation is None
        ):
            raise ValueError(
                "profile, targetProfile, or targetAllocation is required"
            )
        if self.target_allocation is not None:
            if not self.target_allocation:
                raise ValueError("targetAllocation cannot be empty")
            values = list(self.target_allocation.values())
            if any(
                not math.isfinite(value) or value < 0 or value > 1
                for value in values
            ):
                raise ValueError(
                    "targetAllocation weights must be finite values from 0 to 1"
                )
            if not math.isclose(sum(values), 1.0, rel_tol=0.0, abs_tol=1e-6):
                raise ValueError("targetAllocation weights must sum to 1")
        return self


class RebalanceTrade(ApiModel):
    """One exact dollar action; share counts require price/quantity data."""

    symbol: Optional[str]
    name: Optional[str]
    asset: AssetClass
    action: RebalanceAction
    amount: float
    before_value: Optional[float]
    after_value: Optional[float]
    resolved: bool


class RebalanceWarning(ApiModel):
    """Machine-readable planner limitation with UI-ready text."""

    code: Literal[
        "empty_portfolio",
        "below_minimum_trade",
        "cash_constraint",
        "new_money_insufficient",
        "sell_required",
        "unresolved_buy_target",
        "uninvested_cash",
        "target_not_reached",
    ]
    message: str
    asset: Optional[AssetClass] = None
    amount: Optional[float] = None


class RebalancePlanResponse(ApiModel):
    """An executable preview when ``can_apply`` is true; never an order."""

    mode: RebalanceMode
    before_total: float
    after_total: float
    total_traded: float
    estimated_trades: int
    before_allocation: Dict[str, float]
    after_allocation: Dict[str, float]
    target_allocation: Dict[str, float]
    trades: List[RebalanceTrade]
    projected_holdings: List[Holding]
    warnings: List[RebalanceWarning]
    can_apply: bool
    target_source: RebalanceTargetSource
    target_profile: Optional[RiskProfileName]
    total_buys: float
    total_sells: float
    # Planned buys that need the user to choose a security. They appear in
    # trades/afterAllocation but cannot appear in projectedHoldings yet.
    unresolved_amount: float
    cash_remaining: float
    exact_target_reached: bool
    preview_only: Literal[True] = True


class ScenarioSimulationInputs(ApiModel):
    """User-controlled assumptions for a reproducible strategy simulation."""

    contribution: float = Field(ge=0, le=1e7)
    return_adj: float = Field(default=0.0, ge=-0.50, le=0.50)
    rebalance: float = Field(default=0.5, ge=0.0, le=1.0)
    goal_value: float = Field(gt=0, le=1e13)
    horizon_years: int = Field(default=10, ge=1, le=40)
    paths: int = Field(default=2000, ge=100, le=5000)
    seed: int = Field(default=20260806, ge=0, le=4294967295)


class SimulationPercentilePoint(ApiModel):
    year: int
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float


class SimulationTerminalRange(ApiModel):
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float


class ScenarioSimulation(ApiModel):
    """Distributional strategy result; every value comes from seeded paths."""

    blended_return: float
    blended_volatility: float
    goal_value: float
    horizon_years: int
    paths: int
    seed: int
    success_probability: float
    preserve_contributions_probability: float
    expected_terminal: float
    terminal: SimulationTerminalRange
    points: List[SimulationPercentilePoint]
    assumption_driven: bool = True


class ContributionOptimizationInputs(ApiModel):
    """Inputs for reverse-solving the monthly contribution on fixed paths."""

    return_adj: float = Field(default=0.0, ge=-0.50, le=0.50)
    rebalance: float = Field(default=0.5, ge=0.0, le=1.0)
    goal_value: float = Field(gt=0, le=1e13)
    target_probability: float = Field(default=0.75, gt=0.0, lt=1.0)
    horizon_years: int = Field(default=10, ge=1, le=40)
    paths: int = Field(default=800, ge=100, le=5000)
    seed: int = Field(default=20260806, ge=0, le=4294967295)
    max_contribution: float = Field(default=5000, gt=0, le=1e7)
    contribution_step: float = Field(default=50, gt=0, le=1e6)


class ContributionOptimization(ApiModel):
    target_probability: float
    required_contribution: float
    achieved_probability: float
    capped: bool
    max_contribution: float
    contribution_step: float


class ScenarioStrategy(ApiModel):
    """One named strategy included in a scenario-lab comparison."""

    id: str = Field(min_length=1, max_length=64)
    contribution: float = Field(ge=0, le=1e7)
    return_adj: float = Field(default=0.0, ge=-0.50, le=0.50)
    rebalance: float = Field(default=0.5, ge=0.0, le=1.0)


class ScenarioLabRequest(ApiModel):
    """All inputs needed to calculate the interactive AI Assistant lab."""

    profile: InvestorProfile
    holdings: List[Holding] = Field(max_length=200)
    primary: ScenarioStrategy
    strategies: List[ScenarioStrategy] = Field(default_factory=list, max_length=12)
    goal_value: float = Field(gt=0, le=1e13)
    target_probability: float = Field(default=0.75, gt=0.0, lt=1.0)
    horizon_years: int = Field(default=10, ge=1, le=40)
    simulation_paths: int = Field(default=2000, ge=100, le=5000)
    optimization_paths: int = Field(default=800, ge=100, le=5000)
    seed: int = Field(default=20260806, ge=0, le=4294967295)
    max_contribution: float = Field(default=5000, gt=0, le=1e7)
    contribution_step: float = Field(default=50, gt=0, le=1e6)


class ScenarioComparison(ApiModel):
    id: str
    simulation: ScenarioSimulation


class ScenarioLabResponse(ApiModel):
    """Atomic scenario result so every visible number shares one engine."""

    simulation: ScenarioSimulation
    comparisons: List[ScenarioComparison]
    optimization: ContributionOptimization


class AdvisorScenarioContext(ApiModel):
    """The visible Strategy Lab result supplied to the advisor verbatim."""

    contribution: float
    goal_value: float
    horizon_years: int
    modeled_return: float
    modeled_volatility: float
    success_probability: float
    p10: float
    p50: float
    p90: float
    paths: int


class ForecastPoint(ApiModel):
    """One step of the forecast cone — the quantile prices at that horizon.

    `bear`/`median`/`bull` are retained as the 5th/50th/95th percentile so
    previously stored runs and the offline mirror keep rendering.
    """

    day: float = 0.0
    q05: float
    q25: float
    q50: float
    q75: float
    q95: float
    bear: float
    median: float
    bull: float


class BacktestResult(ApiModel):
    """Walk-forward accuracy, measured by replaying the engine on real history.

    `coverage50`/`coverage90` are the calibration numbers: how often reality
    landed inside the 25-75 and 5-95 bands. Well-calibrated means ~0.50 and
    ~0.90; anything far off means the band width is wrong, not just the median.
    """

    windows: int
    hit: float  # directional hit rate
    error: float  # median absolute error, percent of price
    drawdown: float  # realized max drawdown over the sample
    # Non-overlapping horizons the sample spans. Consecutive windows share most
    # of their price path, so this is the honest sample size behind `coverage*`.
    independent_windows: Optional[float] = None
    coverage50: Optional[float] = None
    coverage90: Optional[float] = None
    bias: Optional[float] = None  # >0 = systematically optimistic
    calibration_error: Optional[float] = None
    worst_window: Optional[float] = None
    best_window: Optional[float] = None
    first_origin: Optional[str] = None
    last_origin: Optional[str] = None
    # False when there was not enough history to replay — the UI must not
    # present assumption-derived figures as a measured track record.
    measured: bool = False


class DriftSignalOut(ApiModel):
    """One input to the drift estimate, with its weight and provenance."""

    name: str
    value: float
    weight: float
    detail: str


class ForecastInputs(ApiModel):
    """What the model actually ran on — the honesty panel behind the number."""

    mu: float  # annualized drift used
    sigma: float  # annualized volatility used
    drift_raw: float  # blended signal before shrinkage
    shrinkage: float  # how much of the blend survived
    signals: List[DriftSignalOut]
    vol_measured: bool
    quality_measured: bool
    data_completeness: float  # 0..1
    sources: List[str]
    stale_inputs: List[str] = []
    # Data-integrity problems detected while assembling the inputs.
    warnings: List[str] = []


class SeriesStatsOut(ApiModel):
    """Statistics measured from the real price history.

    The digit-adjacent fields carry explicit aliases: the camel-case generator
    uppercases the letter after a number (`return_3m` -> `return3M`), which
    would make the wire names inconsistent with the rest of the payload
    (`q25Target`, `var95Before`). Pinning them keeps the contract intentional
    rather than an artifact of the generator — test_wire_names guards it.
    """

    observations: int
    vol: float
    vol_simple: float
    downside_vol: Optional[float] = None
    return_1m: Optional[float] = Field(None, alias="return1m")
    return_3m: Optional[float] = Field(None, alias="return3m")
    return_6m: Optional[float] = Field(None, alias="return6m")
    return_12m: Optional[float] = Field(None, alias="return12m")
    momentum_12m1: Optional[float] = Field(None, alias="momentum12m1")
    max_drawdown: float
    high_52w: Optional[float] = Field(None, alias="high52w")
    low_52w: Optional[float] = Field(None, alias="low52w")
    pct_of_52w_range: Optional[float] = Field(None, alias="pctOf52wRange")
    sharpe_trailing: Optional[float] = None


class FundamentalsOut(ApiModel):
    """Company fundamentals, when an OVERVIEW payload was available."""

    market_cap: Optional[float] = None
    beta: Optional[float] = None
    pe_ratio: Optional[float] = None
    forward_pe: Optional[float] = None
    peg_ratio: Optional[float] = None
    price_to_book: Optional[float] = None
    profit_margin: Optional[float] = None
    operating_margin: Optional[float] = None
    return_on_equity: Optional[float] = None
    revenue_growth_yoy: Optional[float] = None
    earnings_growth_yoy: Optional[float] = None
    dividend_yield: Optional[float] = None
    eps: Optional[float] = None
    analyst_target: Optional[float] = None
    industry: Optional[str] = None


class NewsItemOut(ApiModel):
    """A recent headline about the symbol, from the news-sentiment feed."""

    title: str
    source: Optional[str] = None
    url: Optional[str] = None
    published: Optional[str] = None
    summary: Optional[str] = None
    sentiment_label: Optional[str] = None
    sentiment_score: Optional[float] = None


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
    expected: float  # median return over the horizon (decimal)
    paths: List[ForecastPoint]
    backtest: BacktestResult
    trace: StockTrace
    # Provenance of the price input: "alphavantage" | "finnhub" | "offline".
    source: str = "offline"
    as_of: Optional[str] = None

    # --- Distributional detail ------------------------------------------
    q25_target: float = 0.0
    q75_target: float = 0.0
    expected_mean: float = 0.0  # mean (not median) return over the horizon
    # Probabilities under the fitted lognormal, over the requested horizon.
    prob_gain: float = 0.5
    prob_beat_market: float = 0.5
    prob_drawdown10: float = 0.0
    prob_drawdown20: float = 0.0
    annualized_vol: float = 0.0
    sentiment: Optional[float] = None
    sentiment_articles: int = 0
    news: List[NewsItemOut] = Field(default_factory=list)
    inputs: Optional[ForecastInputs] = None
    stats: Optional[SeriesStatsOut] = None
    fundamentals: Optional[FundamentalsOut] = None


class StockAnalyzeRequest(ApiModel):
    ticker: str = Field("AAPL", max_length=12)
    days: float = 30
    # Optional investor context. When present, the Portfolio Agent runs the
    # what-if impact analysis against these holdings.
    profile: Optional[InvestorProfile] = None
    holdings: Optional[List[Holding]] = Field(None, max_length=200)


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

    # --- Risk effect (single-index model, services/risk.py) --------------
    vol_before: float = 0.0
    vol_after: float = 0.0
    vol_delta: float = 0.0
    beta_before: float = 0.0
    beta_after: float = 0.0
    # Share of the post-trade portfolio's volatility attributable to this
    # position — its marginal contribution times its weight.
    risk_contribution: float = 0.0
    diversification_before: float = 1.0
    diversification_after: float = 1.0
    effective_positions_before: float = 0.0
    effective_positions_after: float = 0.0
    # Parametric 95% VaR over the forecast horizon, as a positive loss fraction.
    var95_before: float = 0.0
    var95_after: float = 0.0
    # Expected portfolio return over the horizon, before and after.
    expected_return_before: float = 0.0
    expected_return_after: float = 0.0
    # Largest weight that keeps portfolio vol within the profile's ceiling.
    max_weight_for_profile: float = 0.0
    vol_ceiling: float = 0.0
    # True when the trade improves return per unit of risk.
    improves_risk_adjusted_return: bool = False
    top_risk_contributors: List[RiskContribution] = []


class StockAnalyzeResponse(ApiModel):
    forecast: StockForecast
    impact: Optional[PortfolioImpact] = None
    events: List[AgentEvent]
    # Research memo prose (forecast + impact narration). LLM-written when a key
    # is configured and compliance passes; deterministic template otherwise.
    memo: List[str]
    narrator: Narrator


class AdvisorSourceContext(ApiModel):
    """Visible evidence that launched the assistant from another workspace."""

    origin: Literal["overview", "portfolio", "analyze"]
    kind: Literal[
        "allocation_gap",
        "rebalance_plan",
        "risk_driver",
        "stock_analysis",
        "news_signal",
    ]
    title: str = Field(max_length=160)
    summary: str = Field(max_length=1000)
    suggested_question: str = Field(max_length=1000)
    facts: Dict[str, str] = Field(default_factory=dict)


class AdvisorAskRequest(ApiModel):
    question: str = Field(max_length=2000)
    profile: InvestorProfile
    holdings: List[Holding] = Field(max_length=200)
    stock: StockForecast
    scenario: Optional[AdvisorScenarioContext] = None
    source_context: Optional[AdvisorSourceContext] = None


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
    transactions: List[PortfolioTransaction] = []
    valuations: List[ValuationSnapshot] = []


class HoldingsPut(ApiModel):
    holdings: List[Holding] = Field(max_length=500)


class TransactionsPut(ApiModel):
    transactions: List[PortfolioTransaction] = Field(max_length=5000)


class ValuationsPut(ApiModel):
    valuations: List[ValuationSnapshot] = Field(max_length=2000)


class AnalysisSummary(ApiModel):
    id: str
    symbol: str
    days: float
    rating: str
    source: str
    created_at: str
