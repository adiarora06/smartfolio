// Portfolio risk model — mirror of backend/app/services/risk.py.
//
// Single-index (market-factor) decomposition. Every holding's return is a
// market component plus an independent idiosyncratic component:
//
//     r_i = alpha_i + beta_i * r_market + e_i,    Var(e_i) = sigma_e,i^2
//     sigma_p^2 = (sum_i w_i beta_i)^2 * sigma_m^2 + sum_i w_i^2 * sigma_e,i^2
//
// The second term shrinks as positions get smaller and more numerous — that is
// where diversification actually comes from.
//
// The per-sector figures below are documented assumptions, not measurements.
// Estimating a full covariance matrix from a handful of holdings would be
// dominated by estimation error, and we have no return history for most
// positions anyway.

import { MARKET_VOL, normPpf } from './quant'
import type { Holding } from '../../types'

/** Assumed [beta, annualized total volatility] by equity sector. */
export const SECTOR_RISK: Record<string, [number, number]> = {
  technology: [1.2, 0.28],
  communication_services: [1.05, 0.24],
  consumer_cyclical: [1.15, 0.27],
  financial_services: [1.1, 0.24],
  healthcare: [0.85, 0.2],
  industrial: [1.0, 0.21],
  energy: [1.05, 0.3],
  utilities: [0.55, 0.16],
  consumer_defensive: [0.65, 0.15],
  real_estate: [0.95, 0.22],
  basic_materials: [1.05, 0.24],
  broad_market: [1.0, 0.16],
}

/** Assumed [beta, annualized total volatility] by asset class. */
export const ASSET_RISK: Record<string, [number, number]> = {
  us_equity: [1.0, 0.17],
  intl_equity: [0.9, 0.19],
  bonds: [0.15, 0.06],
  cash: [0.0, 0.002],
  alternatives: [0.5, 0.14],
  crypto: [1.4, 0.65],
  other: [0.6, 0.18],
}

export interface Position {
  label: string
  weight: number
  beta: number
  vol: number
}

export interface RiskDecomposition {
  volatility: number
  systematic: number
  idiosyncratic: number
  beta: number
  diversificationRatio: number
  effectivePositions: number
}

/**
 * Variance not explained by the market factor. Floored at zero: a holding whose
 * assumed vol sits below its beta-implied market vol would otherwise produce a
 * negative variance.
 */
function idiosyncraticVar(p: Position): number {
  return Math.max(p.vol * p.vol - Math.pow(p.beta * MARKET_VOL, 2), 0)
}

/** [beta, vol] assumption for a holding — sector first, then asset class. */
export function riskInputs(h: Holding): [number, number] {
  if (h.asset === 'us_equity' || h.asset === 'intl_equity') {
    const bySector = SECTOR_RISK[h.sector]
    if (bySector) return bySector
  }
  return ASSET_RISK[h.asset] ?? ASSET_RISK.other
}

export function positionsFromHoldings(holdings: Holding[], total?: number): Position[] {
  const sum = total ?? holdings.reduce((s, h) => s + Number(h.value || 0), 0)
  if (sum <= 0) return []
  return holdings.map((h) => {
    const [beta, vol] = riskInputs(h)
    return { label: h.symbol, weight: Number(h.value) / sum, beta, vol }
  })
}

export function decompose(positions: Position[]): RiskDecomposition {
  if (!positions.length) {
    return {
      volatility: 0,
      systematic: 0,
      idiosyncratic: 0,
      beta: 0,
      diversificationRatio: 1,
      effectivePositions: 0,
    }
  }

  const portfolioBeta = positions.reduce((s, p) => s + p.weight * p.beta, 0)
  const systematicVar = Math.pow(portfolioBeta * MARKET_VOL, 2)
  const idioVar = positions.reduce((s, p) => s + p.weight * p.weight * idiosyncraticVar(p), 0)
  const volatility = Math.sqrt(Math.max(systematicVar + idioVar, 0))

  const weightedVol = positions.reduce((s, p) => s + p.weight * p.vol, 0)
  const weightSq = positions.reduce((s, p) => s + p.weight * p.weight, 0)

  return {
    volatility,
    systematic: Math.sqrt(Math.max(systematicVar, 0)),
    idiosyncratic: Math.sqrt(Math.max(idioVar, 0)),
    beta: portfolioBeta,
    diversificationRatio: volatility > 0 ? weightedVol / volatility : 1,
    effectivePositions: weightSq > 0 ? 1 / weightSq : 0,
  }
}

/**
 * d(sigma_p) / d(w_i). Weight times this, summed over all positions, equals
 * portfolio volatility exactly — which is what makes it the right attribution
 * of risk to a holding.
 */
export function marginalContribution(positions: Position[], index: number): number {
  if (!positions.length || index >= positions.length) return 0
  const { volatility } = decompose(positions)
  if (volatility <= 0) return 0
  const portfolioBeta = positions.reduce((s, p) => s + p.weight * p.beta, 0)
  const p = positions[index]
  return (p.beta * portfolioBeta * MARKET_VOL * MARKET_VOL + p.weight * idiosyncraticVar(p)) / volatility
}

/** Parametric VaR as a positive decimal loss fraction over the horizon. */
export function valueAtRisk(volatility: number, horizonYears: number, confidence = 0.95): number {
  if (volatility <= 0 || horizonYears <= 0) return 0
  return Math.abs(normPpf(1 - confidence)) * volatility * Math.sqrt(horizonYears)
}

/**
 * Largest weight for `candidate` keeping portfolio vol at or below the ceiling.
 * Bisection rather than algebra: the objective is monotonic in the candidate
 * weight once the others are renormalized, and twenty iterations land well
 * inside rounding tolerance while keeping the code readable.
 */
export function maxWeightUnderVol(
  positions: Position[],
  candidate: Position,
  volCeiling: number,
): number {
  if (volCeiling <= 0) return 0

  const volAt = (weight: number): number => {
    const scale = 1 - weight
    const blended = positions.map((p) => ({ ...p, weight: p.weight * scale }))
    blended.push({ ...candidate, weight })
    return decompose(blended).volatility
  }

  if (volAt(0) > volCeiling) return 0
  if (volAt(1) <= volCeiling) return 1

  let low = 0
  let high = 1
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2
    if (volAt(mid) <= volCeiling) low = mid
    else high = mid
  }
  return low
}
