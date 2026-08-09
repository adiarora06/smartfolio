// Deterministic portfolio analytics.
//
// This module does the MATH only. It never produces user-facing prose — it
// returns numbers and *structured findings*. Turning those findings into
// sentences is the job of the AI/explanation layer (lib/ai/insights.ts).
// This boundary is the "deterministic code calculates, AI explains" rule from
// the vault, expressed in the folder structure.

import { RETURNS, TARGETS } from '../data/constants'
import type {
    AllocationMap,
    Holding,
    InvestorProfile,
    RiskContribution,
    RiskProfileName,
} from '../../types'
import {
  ASSET_RISK,
  VOL_CEILING,
  conditionalValueAtRisk,
  decompose,
  marginalContribution,
  positionsFromHoldings,
  riskInputs,
  valueAtRisk,
  type Position,
} from './risk'

const EQUITY_ASSETS = ['us_equity', 'intl_equity']

/** Total market value of the portfolio. */
export function portfolioValue(holdings: Holding[]): number {
  return holdings.reduce((sum, h) => sum + Number(h.value || 0), 0)
}

/** Allocation by asset class, as 0..1 weights. */
export function allocation(holdings: Holding[]): AllocationMap {
  const total = portfolioValue(holdings)
  const out: AllocationMap = {}
  if (!total) return out
  holdings.forEach((h) => {
    out[h.asset] = (out[h.asset] || 0) + Number(h.value) / total
  })
  return out
}

/** Sector weights, restricted to equity holdings. */
export function sectorAllocation(holdings: Holding[]): AllocationMap {
  const total = portfolioValue(holdings)
  const out: AllocationMap = {}
  if (!total) return out
  holdings.forEach((h) => {
    if (EQUITY_ASSETS.includes(h.asset)) {
      out[h.sector] = (out[h.sector] || 0) + Number(h.value) / total
    }
  })
  return out
}

/**
 * Score risk tolerance + capacity into a named profile.
 * Returns [profileName, rawScore]. Pure function of the investor profile.
 */
export function riskProfile(profile: InvestorProfile): [RiskProfileName, number] {
  const liq = ({ low: 0, medium: 0.12, high: 0.25 } as Record<string, number>)[profile.liquidity] ?? 0.12
  const cap = Math.max(
    0,
    Math.min(
      1,
      0.45 * (profile.horizon / 30) +
        0.3 * ((70 - profile.age) / 50) +
        0.25 * (profile.emergency / 6) -
        liq,
    ),
  )
  const score = 0.55 * ((profile.risk - 1) / 4) + 0.45 * cap
  const name: RiskProfileName =
    score < 0.3 ? 'conservative' : score < 0.55 ? 'balanced' : score < 0.78 ? 'growth' : 'aggressive'
  return [name, score]
}

export type ConcentrationKind = 'single_stock' | 'stock_aggregate' | 'sector'

/** A structured concentration finding — no prose. */
export interface ConcentrationFinding {
  kind: ConcentrationKind
  /** Symbol for single_stock, sector key for sector, "stocks" for the aggregate. */
  label: string
  /** 0..1 weight of the portfolio this finding represents. */
  weight: number
}

export type RecommendationKind = 'increase' | 'reduce' | 'diversify_single_stock'

/** A structured recommendation signal — no prose. */
export interface RecommendationSignal {
  kind: RecommendationKind
  /** Asset-class key for increase/reduce signals. */
  asset?: string
}

export type StressScenario = 'market_selloff' | 'technology_shock' | 'rate_shock'

export interface PortfolioStressTest {
  scenario: StressScenario
  estimatedReturn: number
  dollarImpact: number
}

export interface PortfolioRiskSnapshot {
  annualizedVolatility: number
  targetVolatility: number
  beta: number
  systematicShare: number
  idiosyncraticShare: number
  diversificationRatio: number
  effectivePositions: number
  volCeiling: number
  riskBudgetUsed: number
  var95OneMonth: number
  cvar95OneMonth: number
  returnToRisk: number
  topContributors: RiskContribution[]
  stressTests: PortfolioStressTest[]
  assumptionDriven: boolean
}

export interface PortfolioAnalysis {
  riskProfileName: RiskProfileName
  riskScore: number
  current: AllocationMap
  target: AllocationMap
  /** target - current, per asset class. */
  gap: AllocationMap
  concentrations: ConcentrationFinding[]
  recommendations: RecommendationSignal[]
  value: number
  /** Blended assumed 1Y return of the current allocation. */
  currentReturn: number
  /** Blended assumed 1Y return of the target allocation. */
  targetReturn: number
  risk: PortfolioRiskSnapshot
}

function stressReturn(holding: Holding, scenario: StressScenario): number {
  const [beta] = riskInputs(holding)
  const isEquity = EQUITY_ASSETS.includes(holding.asset)
  if (scenario === 'market_selloff') {
    if (holding.asset === 'cash') return 0
    return Math.max(-0.65, -0.2 * beta)
  }
  if (scenario === 'technology_shock') {
    if (isEquity && holding.sector === 'technology') return -0.25
    if (isEquity) return -0.03 * beta
    if (holding.asset === 'alternatives') return -0.03
    return 0
  }
  if (holding.asset === 'bonds') return -0.08
  if (holding.asset === 'cash') return 0
  if (isEquity && holding.sector === 'real_estate') return -0.12
  if (isEquity) return -0.05 * beta
  return holding.asset === 'alternatives' ? -0.04 : 0
}

function buildRiskSnapshot(
  holdings: Holding[],
  profileName: RiskProfileName,
  currentReturn: number,
  total: number,
): PortfolioRiskSnapshot {
  const positions = positionsFromHoldings(holdings, total)
  const decomposition = decompose(positions)
  const totalVariance = decomposition.volatility ** 2
  const topContributors: RiskContribution[] = decomposition.volatility > 0
    ? positions.map((position, index) => ({
        label: position.label,
        weight: position.weight,
        volatility: position.vol,
        beta: position.beta,
        riskContribution: Math.max(
          0,
          (position.weight * marginalContribution(positions, index)) / decomposition.volatility,
        ),
      }))
    : []
  topContributors.sort((a, b) => b.riskContribution - a.riskContribution)

  const targetPositions: Position[] = Object.entries(TARGETS[profileName])
    .filter(([, weight]) => weight > 0)
    .map(([asset, weight]) => {
      const [beta, vol] = ASSET_RISK[asset] ?? ASSET_RISK.other
      return { label: asset, weight, beta, vol }
    })
  const targetVolatility = decompose(targetPositions).volatility
  const volCeiling = VOL_CEILING[profileName] ?? 0.15
  const oneMonth = 1 / 12
  const stressTests: PortfolioStressTest[] = (
    ['market_selloff', 'technology_shock', 'rate_shock'] as StressScenario[]
  ).map((scenario) => {
    const estimatedReturn = total > 0
      ? holdings.reduce(
          (sum, holding) => sum + (Number(holding.value) / total) * stressReturn(holding, scenario),
          0,
        )
      : 0
    return { scenario, estimatedReturn, dollarImpact: total * estimatedReturn }
  })

  return {
    annualizedVolatility: decomposition.volatility,
    targetVolatility,
    beta: decomposition.beta,
    systematicShare: totalVariance > 0 ? decomposition.systematic ** 2 / totalVariance : 0,
    idiosyncraticShare: totalVariance > 0 ? decomposition.idiosyncratic ** 2 / totalVariance : 0,
    diversificationRatio: decomposition.diversificationRatio,
    effectivePositions: decomposition.effectivePositions,
    volCeiling,
    riskBudgetUsed: volCeiling > 0 ? decomposition.volatility / volCeiling : 0,
    var95OneMonth: valueAtRisk(decomposition.volatility, oneMonth),
    cvar95OneMonth: conditionalValueAtRisk(decomposition.volatility, oneMonth),
    returnToRisk: decomposition.volatility > 0 ? currentReturn / decomposition.volatility : 0,
    topContributors: topContributors.slice(0, 6),
    stressTests,
    assumptionDriven: true,
  }
}

/**
 * Full deterministic portfolio diagnosis. Detects concentration and gap
 * signals as structured data — the AI layer renders them into sentences.
 */
export function analyzePortfolio(
  holdings: Holding[],
  profile: InvestorProfile,
): PortfolioAnalysis {
  const [riskProfileName, riskScore] = riskProfile(profile)
  const current = allocation(holdings)
  const target = TARGETS[riskProfileName]

  const gap: AllocationMap = {}
  ;[...new Set([...Object.keys(current), ...Object.keys(target)])].sort().forEach((k) => {
    gap[k] = (target[k] || 0) - (current[k] || 0)
  })

  const total = portfolioValue(holdings) || 1
  const sectors = sectorAllocation(holdings)
  const stocks = holdings.filter((h) => h.type === 'stock')

  const concentrations: ConcentrationFinding[] = []
  stocks.forEach((h) => {
    const w = Number(h.value) / total
    if (w > 0.2) concentrations.push({ kind: 'single_stock', label: h.symbol, weight: w })
  })
  const stockWeight = stocks.reduce((s, h) => s + Number(h.value), 0) / total
  if (stockWeight > 0.5) {
    concentrations.push({ kind: 'stock_aggregate', label: 'stocks', weight: stockWeight })
  }
  Object.entries(sectors).forEach(([k, w]) => {
    if (w > 0.35) concentrations.push({ kind: 'sector', label: k, weight: w })
  })

  const recommendations: RecommendationSignal[] = []
  Object.entries(gap).forEach(([asset, d]) => {
    if (d > 0.08) recommendations.push({ kind: 'increase', asset })
    if (d < -0.08) recommendations.push({ kind: 'reduce', asset })
  })
  if (concentrations.some((c) => c.kind === 'single_stock')) {
    recommendations.push({ kind: 'diversify_single_stock' })
  }

  const currentReturn = Object.entries(current).reduce(
    (s, [k, w]) => s + w * (RETURNS[k] || 0),
    0,
  )
  const targetReturn = Object.entries(target).reduce(
    (s, [k, w]) => s + w * (RETURNS[k] || 0),
    0,
  )

  return {
    riskProfileName,
    riskScore,
    current,
    target,
    gap,
    concentrations,
    recommendations,
    value: portfolioValue(holdings),
    currentReturn,
    targetReturn,
    risk: buildRiskSnapshot(holdings, riskProfileName, currentReturn, portfolioValue(holdings)),
  }
}
