// Deterministic portfolio-impact analysis — local mirror of
// backend/app/services/impact.py, so offline mode keeps parity.
//
// Two distinct questions, because they routinely disagree:
//   1. Concentration — does this position breach a weight limit? (weights only)
//   2. Risk — what does it do to volatility, beta, and return per unit of risk?
//
// A position can pass every concentration check and still be the largest single
// contributor to portfolio risk, because risk contribution scales with
// volatility and not just with weight.

import { RETURNS, TARGETS } from '../data/constants'
import { portfolioValue, riskProfile } from './portfolio'
import {
  SECTOR_RISK,
  decompose,
  marginalContribution,
  maxWeightUnderVol,
  positionsFromHoldings,
  valueAtRisk,
  type Position,
} from './risk'
import type {
  Holding,
  InvestorProfile,
  PortfolioImpact,
  RiskContribution,
  StockForecast,
} from '../../types'

const EQUITY_ASSETS = ['us_equity', 'intl_equity']
const SINGLE_STOCK_FLAG = 0.2
const SECTOR_FLAG = 0.35

/** Annualized portfolio volatility each risk profile is willing to carry. */
const VOL_CEILING: Record<string, number> = {
  conservative: 0.09,
  balanced: 0.13,
  growth: 0.18,
  aggressive: 0.25,
}

type ForecastInput = Pick<StockForecast, 'symbol' | 'sector' | 'price'> &
  Partial<Pick<StockForecast, 'vol' | 'days' | 'expected' | 'inputs' | 'fundamentals'>>

export function computeImpact(
  forecast: ForecastInput,
  holdings: Holding[],
  profile: InvestorProfile,
): PortfolioImpact | null {
  if (!holdings.length) return null
  const total = portfolioValue(holdings)
  if (total <= 0) return null

  const added = Math.round(forecast.price * 10)
  const totalAfter = total + added
  const dilution = total / totalAfter
  const addedWeight = added / totalAfter

  const held = holdings
    .filter((h) => h.symbol.trim().toUpperCase() === forecast.symbol)
    .reduce((s, h) => s + Number(h.value), 0)
  const newWeight = (held + added) / totalAfter

  const sectorValue = holdings
    .filter((h) => h.sector === forecast.sector && EQUITY_ASSETS.includes(h.asset))
    .reduce((s, h) => s + Number(h.value), 0)
  const sectorWeightAfter = (sectorValue + added) / totalAfter

  const [name] = riskProfile(profile)
  const target = TARGETS[name]
  const current: Record<string, number> = {}
  holdings.forEach((h) => {
    current[h.asset] = (current[h.asset] || 0) + Number(h.value) / total
  })
  const after: Record<string, number> = {}
  Object.entries(current).forEach(([k, w]) => {
    after[k] = w * dilution
  })
  after.us_equity = (after.us_equity || 0) + addedWeight

  const gapDelta: Record<string, number> = {}
  ;[...new Set([...Object.keys(current), ...Object.keys(target), 'us_equity'])]
    .sort()
    .forEach((k) => {
      const gapBefore = (target[k] || 0) - (current[k] || 0)
      const gapAfter = (target[k] || 0) - (after[k] || 0)
      gapDelta[k] = gapAfter - gapBefore
    })

  // --- Risk effect ---
  const beforePositions = positionsFromHoldings(holdings, total)
  const riskBefore = decompose(beforePositions)

  const sectorFallback = SECTOR_RISK[forecast.sector] ?? [1.0, 0.24]
  const beta =
    forecast.fundamentals?.beta && forecast.fundamentals.beta > 0
      ? forecast.fundamentals.beta
      : sectorFallback[0]
  const candidate: Position = {
    label: forecast.symbol,
    weight: addedWeight,
    beta,
    vol: forecast.vol && forecast.vol > 0 ? forecast.vol : sectorFallback[1],
  }

  const afterPositions: Position[] = beforePositions.map((p) => ({
    ...p,
    weight: p.weight * dilution,
  }))
  afterPositions.push(candidate)
  const riskAfter = decompose(afterPositions)

  const mcr = marginalContribution(afterPositions, afterPositions.length - 1)
  const riskContribution =
    riskAfter.volatility > 0 ? (candidate.weight * mcr) / riskAfter.volatility : 0

  const horizonYears = Math.max(forecast.days ?? 30, 1) / 365
  const annualBefore = holdings.reduce(
    (s, h) => s + (Number(h.value) / total) * (RETURNS[h.asset] ?? 0),
    0,
  )
  const stockMu =
    forecast.inputs?.mu ?? (forecast.expected != null ? forecast.expected / horizonYears : 0.07)
  const annualAfter = annualBefore * dilution + stockMu * addedWeight

  const ratioBefore = riskBefore.volatility > 0 ? annualBefore / riskBefore.volatility : 0
  const ratioAfter = riskAfter.volatility > 0 ? annualAfter / riskAfter.volatility : 0

  const ceiling = VOL_CEILING[name] ?? 0.15

  const topRiskContributors: RiskContribution[] =
    riskAfter.volatility > 0
      ? afterPositions
          .map((p, i) => ({
            label: p.label,
            weight: p.weight,
            volatility: p.vol,
            beta: p.beta,
            riskContribution:
              (p.weight * marginalContribution(afterPositions, i)) / riskAfter.volatility,
          }))
          .sort((a, b) => b.riskContribution - a.riskContribution)
          .slice(0, 6)
      : []

  return {
    addedValue: added,
    newWeight,
    sector: forecast.sector,
    sectorWeightAfter,
    triggersSingleStockFlag: newWeight > SINGLE_STOCK_FLAG,
    triggersSectorFlag: sectorWeightAfter > SECTOR_FLAG,
    gapDelta,
    volBefore: riskBefore.volatility,
    volAfter: riskAfter.volatility,
    volDelta: riskAfter.volatility - riskBefore.volatility,
    betaBefore: riskBefore.beta,
    betaAfter: riskAfter.beta,
    riskContribution,
    diversificationBefore: riskBefore.diversificationRatio,
    diversificationAfter: riskAfter.diversificationRatio,
    effectivePositionsBefore: riskBefore.effectivePositions,
    effectivePositionsAfter: riskAfter.effectivePositions,
    var95Before: valueAtRisk(riskBefore.volatility, horizonYears),
    var95After: valueAtRisk(riskAfter.volatility, horizonYears),
    expectedReturnBefore: annualBefore * horizonYears,
    expectedReturnAfter: annualAfter * horizonYears,
    maxWeightForProfile: maxWeightUnderVol(beforePositions, candidate, ceiling),
    volCeiling: ceiling,
    improvesRiskAdjustedReturn: ratioAfter > ratioBefore,
    topRiskContributors,
  }
}
