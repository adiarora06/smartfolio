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
export type StockTab = 'forecast' | 'backtest' | 'audit' | 'memory' | 'history'

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

export interface ForecastPoint {
  bear: number
  median: number
  bull: number
}

export interface BacktestResult {
  windows: number
  hit: number
  error: number
  drawdown: number
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
  /** Expected return over the horizon (decimal). */
  expected: number
  paths: ForecastPoint[]
  backtest: BacktestResult
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

/** Deterministic what-if: adding the analyzed stock to the current portfolio. */
export interface PortfolioImpact {
  addedValue: number
  newWeight: number
  sector: string
  sectorWeightAfter: number
  triggersSingleStockFlag: boolean
  triggersSectorFlag: boolean
  gapDelta: Record<string, number>
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
