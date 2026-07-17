// Typed client for the SmartFolio FastAPI backend.
//
// The backend owns the canonical deterministic engine + AI explanation layer
// (backend/app). Every call here has a local fallback in the store: when the
// API is unreachable the app degrades gracefully to the client-side mirror in
// lib/calculations + lib/ai, so the static deploy keeps working offline.

import type { Holding, InvestorProfile, StockForecast } from '../../types'
import type { PortfolioAnalysis } from '../calculations/portfolio'
import type { PortfolioInsights } from '../ai/insights'

// `||` (not `??`) so a blank VITE_API_URL in a deploy env falls back instead of
// becoming a relative URL that would hit the frontend's own origin.
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const TIMEOUT_MS = 5000

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${API_URL}${path}`, { ...init, signal: ctrl.signal })
    if (!res.ok) throw new Error(`API ${res.status} on ${path}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export interface HealthResponse {
  status: string
  service: string
  version: string
}

export function apiHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health')
}

export function apiAnalyzeStock(ticker: string, days: number): Promise<StockForecast> {
  return post<StockForecast>('/stocks/analyze', { ticker, days })
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

export function apiAskAdvisor(
  question: string,
  profile: InvestorProfile,
  holdings: Holding[],
  stock: StockForecast,
): Promise<{ answer: string }> {
  return post<{ answer: string }>('/advisor/ask', { question, profile, holdings, stock })
}
