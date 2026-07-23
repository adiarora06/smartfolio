// Deterministic stock forecast engine — the offline mirror.
//
// This runs only when the backend is unreachable. It draws the same lognormal
// quantile cone the backend does (see lib/calculations/quant.ts, mirroring
// backend/app/services/quant.py), but it cannot reproduce the backend's inputs:
// no price history, fundamentals, or news reach the browser, so sigma and mu
// come from the offline reference table rather than from measurement.
//
// Everything it produces is therefore marked unmeasured — `inputs.volMeasured`
// and `backtest.measured` are false — so the UI can say "reference estimate"
// instead of presenting an assumption as an observation.

import { STOCK_BASE } from '../data/constants'
import {
  MARKET_DRIFT,
  probAbove,
  probDrawdown,
  probGain,
  quantilePrice,
  quantileReturn,
} from './quant'
import type { ForecastPoint, StockForecast, StockRating } from '../../types'

/** Stable per-ticker seed so unknown tickers get deterministic pseudo-data. */
export function seed(ticker: string): number {
  return ticker.split('').reduce((s, c, i) => s + c.charCodeAt(0) * (i + 3), 0)
}

const FALLBACK_SECTORS = ['technology', 'healthcare', 'financial_services', 'industrial'] as const

const CONE_STEPS = 24

const AUDIT_TRACE = [
  'Ticker normalized',
  'Market data resolved',
  'Parameters estimated',
  'Forecast cone generated',
  'Walk-forward backtest run',
  'Portfolio risk decomposed',
  'Memo written',
]

// Mirrors the backend pipeline order in orchestrator.py.
const TOPOLOGY_TRACE = [
  'Ticker Intake Agent normalizes symbol and horizon.',
  'Market Data Tool resolves quote, daily history, fundamentals, and news tone.',
  'Parameter Estimation Agent fits annualized volatility and a shrunk drift.',
  'Stock Forecast Agent produces the lognormal quantile cone.',
  'Backtest Agent replays the estimator across past origins for calibration.',
  'Portfolio Agent decomposes risk contribution under a single-index model.',
  'Memo Writer narrates the result (template in local mode).',
  'Compliance Agent frames output as educational analysis.',
]

/** Same three-way mapping the backend uses — thresholds close to a coin flip. */
function rate(pGain: number): StockRating {
  if (pGain > 0.58) return 'Constructive'
  if (pGain > 0.46) return 'Neutral'
  return 'Cautious'
}

/**
 * Run a deterministic offline analysis for a ticker.
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
  const t = horizon / 365

  const sigma = Math.max(0.06, Math.min(1.2, vol))
  // No measured signals offline, so the reference trend gets the same hard
  // shrink toward the market prior the backend applies at zero completeness.
  const shrinkage = 0.15
  const raw = trend + (quality - 0.6) * 0.06
  const mu = Math.max(-0.35, Math.min(0.45, MARKET_DRIFT + shrinkage * (raw - MARKET_DRIFT)))

  const paths: ForecastPoint[] = Array.from({ length: CONE_STEPS + 1 }, (_, i) => {
    const ti = t * (i / CONE_STEPS)
    const q = (p: number) => quantilePrice(price, mu, sigma, ti, p)
    const q05 = q(0.05)
    const q50 = q(0.5)
    const q95 = q(0.95)
    return {
      day: ti * 365,
      q05,
      q25: q(0.25),
      q50,
      q75: q(0.75),
      q95,
      bear: q05,
      median: q50,
      bull: q95,
    }
  })

  const pGain = probGain(mu, sigma, t)
  const marketBenchmark = price * Math.exp(MARKET_DRIFT * t)

  return {
    symbol,
    name,
    sector,
    price,
    days: horizon,
    vol: sigma,
    quality,
    rating: rate(pGain),
    confidence: pGain,
    medianTarget: quantilePrice(price, mu, sigma, t, 0.5),
    bearTarget: quantilePrice(price, mu, sigma, t, 0.05),
    bullTarget: quantilePrice(price, mu, sigma, t, 0.95),
    q25Target: quantilePrice(price, mu, sigma, t, 0.25),
    q75Target: quantilePrice(price, mu, sigma, t, 0.75),
    expected: quantileReturn(mu, sigma, t, 0.5),
    expectedMean: Math.exp(mu * t) - 1,
    probGain: pGain,
    probBeatMarket: probAbove(price, marketBenchmark, mu, sigma, t),
    probDrawdown10: probDrawdown(mu, sigma, t, 0.1),
    probDrawdown20: probDrawdown(mu, sigma, t, 0.2),
    annualizedVol: sigma,
    sentiment: null,
    sentimentArticles: 0,
    paths,
    backtest: {
      // No price history in the browser, so there is nothing to replay.
      // `measured: false` is what stops the UI claiming a track record.
      windows: 0,
      hit: 0.5,
      error: sigma * 100 * Math.sqrt(t),
      drawdown: -sigma * 0.62,
      measured: false,
    },
    inputs: {
      mu,
      sigma,
      driftRaw: raw,
      shrinkage,
      signals: [],
      volMeasured: false,
      qualityMeasured: false,
      dataCompleteness: 0,
      sources: ['offline:reference'],
      staleInputs: [],
    },
    stats: null,
    fundamentals: null,
    trace: {
      audit: [...AUDIT_TRACE],
      topology: [...TOPOLOGY_TRACE],
    },
    // The local mirror only has the offline reference table; live prices,
    // history, and fundamentals come from the backend (backend/app/marketdata).
    source: 'offline',
    asOf: null,
  }
}
