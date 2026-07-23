// Shared domain types for SmartFolio.
// These mirror the data model in the vault (11 Data Model.md) and will map onto
// the backend's Pydantic models in Phase 3.

export type Page = 'landing' | 'setup' | 'app'
export type Screen =
  | 'overview'
  | 'portfolio'
  | 'stock'
  | 'scenarios'
  | 'advisor'
  | 'connections'
  | 'opensource'
export type StockTab =
  | 'forecast'
  | 'impact'
  | 'backtest'
  | 'inputs'
  | 'audit'
  | 'memory'
  | 'history'

export type RiskProfileName = 'conservative' | 'balanced' | 'growth' | 'aggressive'
export type Liquidity = 'low' | 'medium' | 'high'
export type Goal = 'long_term_growth' | 'retirement' | 'income'

export type HoldingType = 'stock' | 'etf' | 'cash'
export type AssetClass =
  | 'us_equity'
  | 'intl_equity'
  | 'bonds'
  | 'cash'
  | 'alternatives'
  | 'crypto'
  | 'other'

/** A map from an asset class (or sector) key to a 0..1 weight. */
export type AllocationMap = Record<string, number>

export interface InvestorProfile {
  age: number
  income: number
  contribution: number
  horizon: number
  /** Risk tolerance, 1 (low) .. 5 (high). */
  risk: number
  /** Emergency fund, in months of expenses. */
  emergency: number
  goal: Goal
  liquidity: Liquidity
}

export interface Holding {
  symbol: string
  name: string
  type: HoldingType
  asset: AssetClass
  sector: string
  value: number
}

export interface Connection {
  name: string
  type: string
  on: boolean
}

export interface ChatMessage {
  role: 'ai' | 'user'
  text: string
}

export interface SavedMemo {
  symbol: string
  rating: StockRating
  memo: string
}

export type StockRating = 'Constructive' | 'Neutral' | 'Cautious'

/**
 * One step of the forecast cone — the quantile prices at that horizon.
 * `bear`/`median`/`bull` alias q05/q50/q95 so runs stored before the
 * distributional engine landed still render.
 */
export interface ForecastPoint {
  day: number
  q05: number
  q25: number
  q50: number
  q75: number
  q95: number
  bear: number
  median: number
  bull: number
}

/**
 * Walk-forward accuracy, measured by replaying the engine on real history.
 * `coverage50`/`coverage90` are the calibration numbers — how often reality
 * landed inside the 25–75 and 5–95 bands. Well-calibrated is ~0.50 and ~0.90.
 * When `measured` is false there was too little history to replay and the
 * remaining fields are assumptions, not a track record.
 */
export interface BacktestResult {
  windows: number
  hit: number
  error: number
  drawdown: number
  /** Non-overlapping horizons the sample spans — the honest sample size. */
  independentWindows?: number | null
  coverage50?: number | null
  coverage90?: number | null
  bias?: number | null
  calibrationError?: number | null
  worstWindow?: number | null
  bestWindow?: number | null
  firstOrigin?: string | null
  lastOrigin?: string | null
  measured: boolean
}

/** One input to the drift estimate, with its weight and provenance. */
export interface DriftSignal {
  name: string
  value: number
  weight: number
  detail: string
}

/** What the model actually ran on — the honesty panel behind the number. */
export interface ForecastInputs {
  /** Annualized drift used. */
  mu: number
  /** Annualized volatility used. */
  sigma: number
  driftRaw: number
  shrinkage: number
  signals: DriftSignal[]
  volMeasured: boolean
  qualityMeasured: boolean
  dataCompleteness: number
  sources: string[]
  staleInputs: string[]
  /** Data-integrity problems detected while assembling the inputs. */
  warnings?: string[]
}

/** Statistics measured from the real price history. */
export interface SeriesStats {
  observations: number
  vol: number
  volSimple: number
  downsideVol?: number | null
  return1m?: number | null
  return3m?: number | null
  return6m?: number | null
  return12m?: number | null
  momentum12m1?: number | null
  maxDrawdown: number
  high52w?: number | null
  low52w?: number | null
  pctOf52wRange?: number | null
  sharpeTrailing?: number | null
}

/** Company fundamentals, when an OVERVIEW payload was available. */
export interface Fundamentals {
  marketCap?: number | null
  beta?: number | null
  peRatio?: number | null
  forwardPe?: number | null
  pegRatio?: number | null
  priceToBook?: number | null
  profitMargin?: number | null
  operatingMargin?: number | null
  returnOnEquity?: number | null
  revenueGrowthYoy?: number | null
  earningsGrowthYoy?: number | null
  dividendYield?: number | null
  eps?: number | null
  analystTarget?: number | null
  industry?: string | null
}

/**
 * Deterministic output of the stock forecast engine — numbers only.
 * The natural-language memo lives in the AI layer (lib/ai/memo.ts).
 */
export interface StockForecast {
  symbol: string
  name: string
  sector: string
  price: number
  days: number
  vol: number
  quality: number
  rating: StockRating
  confidence: number
  medianTarget: number
  bearTarget: number
  bullTarget: number
  /** Median return over the horizon (decimal). */
  expected: number
  paths: ForecastPoint[]
  backtest: BacktestResult

  // --- Distributional detail ---
  q25Target: number
  q75Target: number
  /** Mean (not median) return over the horizon. */
  expectedMean: number
  /** P(the position is up over the horizon), under the fitted lognormal. */
  probGain: number
  /** P(beating a market-return benchmark over the same horizon). */
  probBeatMarket: number
  /** P(touching a 10% / 20% drawdown at any point before the horizon). */
  probDrawdown10: number
  probDrawdown20: number
  annualizedVol: number
  /** Relevance-weighted news tone, -1..1. */
  sentiment?: number | null
  sentimentArticles: number
  inputs?: ForecastInputs | null
  stats?: SeriesStats | null
  fundamentals?: Fundamentals | null
  /** Agent/tool trace shown in the terminal — deterministic given the inputs. */
  trace: {
    audit: string[]
    topology: string[]
  }
  /** Provenance of the price: "alphavantage" | "finnhub" | "offline". */
  source: string
  /** Trading day the live price is from (ISO date), when live. */
  asOf?: string | null
}

/** One step of the backend analysis pipeline — a real timed trace entry. */
export interface AgentEvent {
  agent: string
  status: 'succeeded' | 'failed' | 'skipped'
  durationMs: number
  detail: string
}

/**
 * A holding's share of total portfolio risk (not of portfolio value).
 * The two diverge sharply for volatile positions — that gap is the point.
 */
export interface RiskContribution {
  label: string
  weight: number
  volatility: number
  beta: number
  riskContribution: number
}

/** Deterministic what-if: adding the analyzed stock to the current portfolio. */
export interface PortfolioImpact {
  addedValue: number
  newWeight: number
  sector: string
  sectorWeightAfter: number
  triggersSingleStockFlag: boolean
  triggersSectorFlag: boolean
  gapDelta: Record<string, number>

  // --- Risk effect (single-index model) ---
  volBefore: number
  volAfter: number
  volDelta: number
  betaBefore: number
  betaAfter: number
  /** Share of post-trade portfolio volatility attributable to this position. */
  riskContribution: number
  diversificationBefore: number
  diversificationAfter: number
  effectivePositionsBefore: number
  effectivePositionsAfter: number
  /** Parametric 95% VaR over the horizon, as a positive loss fraction. */
  var95Before: number
  var95After: number
  expectedReturnBefore: number
  expectedReturnAfter: number
  /** Largest weight keeping portfolio vol within the profile's ceiling. */
  maxWeightForProfile: number
  volCeiling: number
  improvesRiskAdjustedReturn: boolean
  topRiskContributors: RiskContribution[]
}

/** Which engine narrated the prose: a real LLM or the deterministic template. */
export type Narrator = 'llm' | 'template'

/** Full response of POST /stocks/analyze. */
export interface StockAnalyzeResponse {
  forecast: StockForecast
  impact: PortfolioImpact | null
  events: AgentEvent[]
  memo: string[]
  narrator: Narrator
}
