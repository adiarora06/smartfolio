// Typed client for the SmartFolio FastAPI backend.
//
// Python owns canonical financial calculations. Selected read-only features
// retain explicit local fallbacks, while backend-only models surface an honest
// unavailable state instead of silently running a second implementation.

import type {
  AllocationMap,
  AssetClass,
  AssistantSourceContext,
  Holding,
  InvestorProfile,
  PortfolioTransaction,
  RiskProfileName,
  StockAnalyzeResponse,
  StockForecast,
  ValuationSnapshot,
} from '../../types'
import type {
  PerformanceRangeRequest,
  PerformanceSummary,
} from '../calculations/performance'
import type { PortfolioAnalysis } from '../calculations/portfolio'
import type {
  AdvisorScenarioContext,
  ContributionOptimization,
  ScenarioInputs,
  ScenarioSimulation,
} from '../calculations/scenario'
import type { PortfolioInsights } from '../ai/insights'

// `||` (not `??`) so a blank VITE_API_URL in a deploy env falls back instead of
// becoming a relative URL that would hit the frontend's own origin.
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const DEFAULT_TIMEOUT_MS = 5000
// Analysis + advisor calls may traverse a live market-data fetch and an LLM
// generation server-side — give them real headroom.
const SLOW_TIMEOUT_MS = 30000

interface RequestOpts {
  timeoutMs?: number
  headers?: Record<string, string>
}

async function request<T>(path: string, init?: RequestInit, opts?: RequestOpts): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await fetch(`${API_URL}${path}`, { ...init, signal: ctrl.signal })
    if (!res.ok) throw new Error(`API ${res.status} on ${path}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

function post<T>(path: string, body: unknown, opts?: RequestOpts): Promise<T> {
  return request<T>(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...opts?.headers },
      body: JSON.stringify(body),
    },
    opts,
  )
}

function put<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export interface HealthResponse {
  status: string
  service: string
  version: string
  liveMarketData: boolean
  marketDataProvider: string
  /** Deep-data provider (history + fundamentals), null when quote-only. */
  deepDataProvider?: string | null
  /** True when quotes and deep data come from different providers. */
  hybridMarketData?: boolean
  deepAnalysis?: boolean
  newsSentiment?: boolean
  llm: boolean
  llmModel: string | null
  llmProvider: string
  database: string
  plaid: boolean
}

export function apiHealth(opts?: RequestOpts): Promise<HealthResponse> {
  return request<HealthResponse>('/health', undefined, opts)
}

/** Full pipeline run. Sends investor context so the Portfolio Agent can run
 *  the what-if impact; sends the workspace id so the run is persisted. */
export function apiAnalyzeStock(
  ticker: string,
  days: number,
  profile: InvestorProfile,
  holdings: Holding[],
  workspaceId?: string | null,
): Promise<StockAnalyzeResponse> {
  return post<StockAnalyzeResponse>(
    '/stocks/analyze',
    { ticker, days, profile, holdings },
    {
      timeoutMs: SLOW_TIMEOUT_MS,
      headers: workspaceId ? { 'X-Workspace-Id': workspaceId } : undefined,
    },
  )
}

export interface PortfolioAnalyzeResult {
  analysis: PortfolioAnalysis
  insights: PortfolioInsights
}

export function apiAnalyzePortfolio(
  profile: InvestorProfile,
  holdings: Holding[],
): Promise<PortfolioAnalyzeResult> {
  return post<PortfolioAnalyzeResult>('/portfolio/analyze', { profile, holdings })
}

export interface PortfolioPosition {
  holdingId: string | null
  symbol: string
  marketValue: number
  costBasis: number | null
  averageCost: number | null
  unrealizedGain: number | null
  unrealizedGainPct: number | null
  valuationMode: 'reported_value' | 'quantity_priced'
  gainStatus: 'complete' | 'unavailable'
  priceStatus: 'current' | 'cached' | 'stale' | 'reference' | 'manual' | 'unavailable'
}

export interface PortfolioPositionSummary {
  marketValue: number
  coveredMarketValue: number
  costBasis: number | null
  unrealizedGain: number | null
  unrealizedGainPct: number | null
  costBasisCoverage: number
  quantityCoverage: number
  pricedCoverage: number
  calculationStatus: 'complete' | 'partial' | 'unavailable'
}

export interface PortfolioPositionWarning {
  code: string
  message: string
  holdingId: string | null
  symbol: string
}

export interface PortfolioPositionsResult {
  holdings: Holding[]
  positions: PortfolioPosition[]
  summary: PortfolioPositionSummary
  warnings: PortfolioPositionWarning[]
}

export function apiAnalyzePositions(
  holdings: Holding[],
  options: {
    refreshPrices?: boolean
    allowOfflineReferencePrices?: boolean
  } = {},
): Promise<PortfolioPositionsResult> {
  return post<PortfolioPositionsResult>(
    '/portfolio/positions',
    {
      holdings,
      refreshPrices: options.refreshPrices ?? false,
      allowOfflineReferencePrices: options.allowOfflineReferencePrices ?? false,
    },
    { timeoutMs: SLOW_TIMEOUT_MS },
  )
}

export type RebalanceMode = 'rebalance' | 'new_money_only'
export type RebalanceAction = 'buy' | 'sell'

/** One deterministic model trade. A missing symbol is intentionally unresolved:
 * the engine knows which asset class is needed, but does not invent a security. */
export interface RebalanceTrade {
  holdingId?: string | null
  symbol?: string | null
  name?: string | null
  asset: AssetClass
  action: RebalanceAction
  amount: number
  beforeValue?: number | null
  afterValue?: number | null
  resolved: boolean
}

export interface RebalancePreview {
  mode: RebalanceMode
  beforeTotal: number
  afterTotal: number
  totalTraded: number
  estimatedTrades: number
  beforeAllocation: AllocationMap
  afterAllocation: AllocationMap
  targetAllocation: AllocationMap
  targetSource: 'risk_profile' | 'custom'
  targetProfile?: RiskProfileName | null
  /** Canonical modeled holdings after the plan. Apply and undo use this exact payload. */
  projectedHoldings: Holding[]
  trades: RebalanceTrade[]
  warnings: Array<{
    code: string
    message: string
    asset?: AssetClass | null
    amount?: number | null
  }>
  canApply: boolean
  totalBuys: number
  totalSells: number
  cashRemaining: number
  unresolvedAmount: number
  exactTargetReached: boolean
  previewOnly: boolean
}

export interface RebalancePreviewInput {
  profile: InvestorProfile
  holdings: Holding[]
  mode: RebalanceMode
  contributionAmount: number
  minTradeAmount: number
}

/** Preview only. SmartFolio never sends brokerage orders from this endpoint. */
export function apiPreviewRebalance(input: RebalancePreviewInput): Promise<RebalancePreview> {
  return post<RebalancePreview>(
    '/portfolio/rebalance',
    { ...input, previewOnly: true },
    { timeoutMs: SLOW_TIMEOUT_MS },
  )
}

export function apiCalculatePerformance(
  transactions: PortfolioTransaction[],
  valuations: ValuationSnapshot[],
  range: PerformanceRangeRequest = { preset: 'all' },
): Promise<{ performance: PerformanceSummary }> {
  return post<{ performance: PerformanceSummary }>('/portfolio/performance', {
    transactions,
    valuations,
    range,
  })
}

export interface ScenarioLabStrategy extends ScenarioInputs {
  id: string
}

export interface ScenarioLabResult {
  simulation: ScenarioSimulation
  comparisons: Array<{ id: string; simulation: ScenarioSimulation }>
  optimization: ContributionOptimization
}

export function apiRunScenarioLab(
  profile: InvestorProfile,
  holdings: Holding[],
  primary: ScenarioLabStrategy,
  strategies: ScenarioLabStrategy[],
  options: {
    goalValue: number
    targetProbability: number
    horizonYears: number
    simulationPaths: number
    optimizationPaths: number
    seed: number
    maxContribution: number
    contributionStep: number
  },
): Promise<ScenarioLabResult> {
  return post<ScenarioLabResult>(
    '/portfolio/scenario-lab',
    {
      profile,
      holdings,
      primary,
      strategies,
      goalValue: options.goalValue,
      targetProbability: options.targetProbability,
      horizonYears: options.horizonYears,
      simulationPaths: options.simulationPaths,
      optimizationPaths: options.optimizationPaths,
      seed: options.seed,
      maxContribution: options.maxContribution,
      contributionStep: options.contributionStep,
    },
    { timeoutMs: SLOW_TIMEOUT_MS },
  )
}

export interface AdvisorAnswer {
  answer: string
  narrator: 'llm' | 'template'
}

export function apiAskAdvisor(
  question: string,
  profile: InvestorProfile,
  holdings: Holding[],
  stock: StockForecast,
  scenario?: AdvisorScenarioContext,
  sourceContext?: AssistantSourceContext,
): Promise<AdvisorAnswer> {
  const visibleSource = sourceContext
    ? {
        origin: sourceContext.origin,
        kind: sourceContext.kind,
        title: sourceContext.title,
        summary: sourceContext.summary,
        suggestedQuestion: sourceContext.suggestedQuestion,
        facts: sourceContext.facts,
      }
    : undefined
  return post<AdvisorAnswer>(
    '/advisor/ask',
    { question, profile, holdings, stock, scenario, sourceContext: visibleSource },
    { timeoutMs: SLOW_TIMEOUT_MS },
  )
}

// --- Workspace persistence -------------------------------------------------

export interface ServerMemo {
  id: string
  symbol: string
  rating: string
  body: string
  createdAt: string
}

export interface WorkspaceState {
  profile: InvestorProfile | null
  holdings: Holding[]
  memos: ServerMemo[]
  transactions: PortfolioTransaction[]
  valuations: ValuationSnapshot[]
}

export function apiCreateWorkspace(): Promise<{ id: string }> {
  return post<{ id: string }>('/workspaces', {})
}

export function apiGetWorkspaceState(workspaceId: string): Promise<WorkspaceState> {
  return request<WorkspaceState>(`/workspaces/${workspaceId}/state`)
}

export function apiPutProfile(workspaceId: string, profile: InvestorProfile): Promise<unknown> {
  return put(`/workspaces/${workspaceId}/profile`, profile)
}

export function apiPutHoldings(workspaceId: string, holdings: Holding[]): Promise<unknown> {
  return put(`/workspaces/${workspaceId}/holdings`, { holdings })
}

export function apiPutTransactions(
  workspaceId: string,
  transactions: PortfolioTransaction[],
): Promise<unknown> {
  return put(`/workspaces/${workspaceId}/transactions`, { transactions })
}

export function apiPutValuations(
  workspaceId: string,
  valuations: ValuationSnapshot[],
): Promise<unknown> {
  return put(`/workspaces/${workspaceId}/valuations`, { valuations })
}

export function apiPostMemo(
  workspaceId: string,
  memo: { symbol: string; rating: string; body: string },
): Promise<ServerMemo> {
  return post<ServerMemo>(`/workspaces/${workspaceId}/memos`, memo)
}

// --- Analysis history --------------------------------------------------------

export interface AnalysisSummary {
  id: string
  symbol: string
  days: number
  rating: string
  source: string
  createdAt: string
}

export function apiListAnalyses(workspaceId: string, limit = 20): Promise<AnalysisSummary[]> {
  return request<AnalysisSummary[]>(`/workspaces/${workspaceId}/analyses?limit=${limit}`)
}

/** A full stored run — same shape the live analyze endpoint returns. */
export function apiGetAnalysis(
  analysisId: string,
  workspaceId: string,
): Promise<StockAnalyzeResponse> {
  return request<StockAnalyzeResponse>(`/analyses/${analysisId}`, {
    headers: { 'X-Workspace-Id': workspaceId },
  })
}

// --- Plaid brokerage sync ----------------------------------------------------

export function apiPlaidLinkToken(): Promise<{ linkToken: string }> {
  return post<{ linkToken: string }>('/plaid/link-token', {})
}

export interface PlaidImportResult {
  institution: string | null
  holdings: Holding[]
}

export function apiPlaidImportHoldings(publicToken: string): Promise<PlaidImportResult> {
  return post<PlaidImportResult>(
    '/plaid/holdings',
    { publicToken },
    { timeoutMs: SLOW_TIMEOUT_MS },
  )
}
