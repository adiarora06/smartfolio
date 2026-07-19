// Deterministic stock forecast engine.
//
// Given a ticker + horizon, produce forecast bands, a confidence score, a
// rating, and a prototype backtest — all as numbers. The natural-language
// research memo is generated separately in lib/ai/memo.ts.

import { STOCK_BASE } from '../data/constants'
import type { StockForecast, StockRating } from '../../types'

/** Stable per-ticker seed so unknown tickers get deterministic pseudo-data. */
export function seed(ticker: string): number {
  return ticker.split('').reduce((s, c, i) => s + c.charCodeAt(0) * (i + 3), 0)
}

const FALLBACK_SECTORS = ['technology', 'healthcare', 'financial_services', 'industrial'] as const

const AUDIT_TRACE = [
  'Ticker normalized',
  'Market data resolved',
  'Forecast generated',
  'Backtest sampled',
  'Memo written',
]

// Mirrors the backend pipeline order in orchestrator.py (7 steps).
const TOPOLOGY_TRACE = [
  'Ticker Intake Agent normalizes symbol and horizon.',
  'Market Data Tool provides price, volatility, sector, and quality inputs.',
  'Stock Forecast Agent creates median, bear, and bull paths.',
  'Backtest Agent evaluates sample windows.',
  'Portfolio Agent checks concentration risk.',
  'Memo Writer narrates the result (template in local mode).',
  'Compliance Agent frames output as educational analysis.',
]

/**
 * Run a deterministic prototype analysis for a ticker.
 * Same inputs always yield the same forecast — no randomness.
 */
export function analyzeStock(ticker = 'AAPL', days = 30): StockForecast {
  const symbol = ticker.trim().toUpperCase() || 'AAPL'
  const sd = seed(symbol)

  const base =
    STOCK_BASE[symbol] ??
    ([
      symbol + ' Corp.',
      FALLBACK_SECTORS[sd % 4],
      40 + (sd % 260),
      0.18 + (sd % 28) / 100,
      -0.03 + (sd % 18) / 100,
      0.45 + (sd % 45) / 100,
    ] as [string, string, number, number, number, number])

  const [name, sector, price, vol, trend, quality] = base

  const horizon = Math.max(7, Math.min(365, Number(days) || 30))
  const scale = horizon / 365
  const med = trend * scale + (quality - 0.6) * 0.06 * scale
  const unc = vol * Math.sqrt(scale)
  const bear = med - unc * 0.85
  const bull = med + unc * 0.95
  const confidence = Math.max(0, Math.min(1, 0.5 + med * 2.2 + quality * 0.28 - vol * 0.22))
  const rating: StockRating =
    confidence > 0.72 ? 'Constructive' : confidence > 0.5 ? 'Neutral' : 'Cautious'

  const paths = Array.from({ length: 16 }, (_, i) => {
    const x = i / 15
    const w = Math.sin(x * Math.PI * 2 + sd / 19) * vol * 0.018
    return {
      bear: price * (1 + bear * x),
      median: price * (1 + med * x + w),
      bull: price * (1 + bull * x),
    }
  })

  return {
    symbol,
    name,
    sector,
    price,
    days: horizon,
    vol,
    quality,
    rating,
    confidence,
    medianTarget: price * (1 + med),
    bearTarget: price * (1 + bear),
    bullTarget: price * (1 + bull),
    expected: med,
    paths,
    backtest: {
      windows: 18 + (sd % 9),
      hit: 0.52 + quality * 0.22 - vol * 0.16,
      error: vol * 7.5,
      drawdown: -vol * 0.62,
    },
    trace: {
      audit: [...AUDIT_TRACE],
      topology: [...TOPOLOGY_TRACE],
    },
    // The local mirror only has the offline reference table; live prices come
    // from the backend (backend/app/marketdata).
    source: 'offline',
    asOf: null,
  }
}
