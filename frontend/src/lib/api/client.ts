// Typed client for the SmartFolio FastAPI backend.
//
// The backend owns the canonical deterministic engine + AI explanation layer
// (backend/app). Every call here has a local fallback in the store: when the
// API is unreachable the app degrades gracefully to the client-side mirror in
// lib/calculations + lib/ai, so the static deploy keeps working offline.

import type {
  Holding,
  InvestorProfile,
  StockAnalyzeResponse,
  StockForecast,
} from '../../types'
import type { PortfolioAnalysis } from '../calculations/portfolio'
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
  llm: boolean
  llmModel: string | null
  llmProvider: string
  database: string
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

export interface AdvisorAnswer {
  answer: string
  narrator: 'llm' | 'template'
}

export function apiAskAdvisor(
  question: string,
  profile: InvestorProfile,
  holdings: Holding[],
  stock: StockForecast,
): Promise<AdvisorAnswer> {
  return post<AdvisorAnswer>(
    '/advisor/ask',
    { question, profile, holdings, stock },
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
export function apiGetAnalysis(analysisId: string): Promise<StockAnalyzeResponse> {
  return request<StockAnalyzeResponse>(`/analyses/${analysisId}`)
}
