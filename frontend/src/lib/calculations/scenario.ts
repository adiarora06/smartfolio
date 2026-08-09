// Deterministic strategy projection and seeded Monte Carlo distribution.
//
// The simulation mirrors backend/app/services/scenario.py. A fixed LCG and
// Box-Muller transform make every run reproducible and let preset comparisons
// share the same random paths.

import type { PortfolioAnalysis } from './portfolio'

export interface ScenarioInputs {
  /** Monthly contribution in dollars. */
  contribution: number
  /** Manual return adjustment (decimal, e.g. +0.02). */
  returnAdj: number
  /** Rebalancing intensity toward the target allocation, 0..1. */
  rebalance: number
}

export interface ScenarioProjection {
  /** Blended annual return actually used (decimal). */
  blendedReturn: number
  points: Array<{ years: number; value: number }>
  /** Year-by-year values 0..10 with contributions — the chart line. */
  series: number[]
  /** Same horizon with $0 contributions — shows what saving adds. */
  growthOnlySeries: number[]
}

export interface SimulationPercentilePoint {
  year: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

export interface SimulationTerminalRange {
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

export interface ScenarioSimulationOptions {
  goalValue: number
  horizonYears?: number
  paths?: number
  seed?: number
}

export interface ScenarioSimulation {
  blendedReturn: number
  blendedVolatility: number
  goalValue: number
  horizonYears: number
  paths: number
  seed: number
  successProbability: number
  preserveContributionsProbability: number
  expectedTerminal: number
  terminal: SimulationTerminalRange
  points: SimulationPercentilePoint[]
  assumptionDriven: true
}

export interface AdvisorScenarioContext {
  contribution: number
  goalValue: number
  horizonYears: number
  modeledReturn: number
  modeledVolatility: number
  successProbability: number
  p10: number
  p50: number
  p90: number
  paths: number
}

export interface ContributionOptimizationOptions {
  goalValue: number
  targetProbability: number
  horizonYears?: number
  paths?: number
  seed?: number
  maxContribution?: number
  contributionStep?: number
}

export interface ContributionOptimization {
  targetProbability: number
  requiredContribution: number
  achievedProbability: number
  capped: boolean
  maxContribution: number
  contributionStep: number
}

export const DEFAULT_SIMULATION_SEED = 20260806
const UINT32_RANGE = 4294967297

export function projectScenario(
  analysis: Pick<PortfolioAnalysis, 'value' | 'currentReturn' | 'targetReturn'>,
  inputs: ScenarioInputs,
): ScenarioProjection {
  const blendedReturn =
    analysis.currentReturn * (1 - inputs.rebalance) +
    analysis.targetReturn * inputs.rebalance +
    inputs.returnAdj

  const monthly = Math.pow(1 + blendedReturn, 1 / 12) - 1
  const yearly = (contribution: number): number[] => {
    const values = [analysis.value]
    let v = analysis.value
    for (let year = 1; year <= 10; year++) {
      for (let m = 0; m < 12; m++) v = v * (1 + monthly) + contribution
      values.push(v)
    }
    return values
  }

  const series = yearly(inputs.contribution)
  return {
    blendedReturn,
    points: [1, 5, 10].map((years) => ({ years, value: series[years] })),
    series,
    growthOnlySeries: yearly(0),
  }
}

function normalGenerator(seed: number): () => number {
  let state = seed >>> 0
  const uniform = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return (state + 1) / UINT32_RANGE
  }
  return () => {
    const u1 = Math.max(uniform(), 1e-12)
    const u2 = uniform()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }
}

function percentile(sortedValues: number[], quantile: number): number {
  if (!sortedValues.length) return 0
  const position = (sortedValues.length - 1) * quantile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sortedValues[lower]
  const weight = position - lower
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

function percentilePoint(year: number, values: number[]): SimulationPercentilePoint {
  const ordered = [...values].sort((a, b) => a - b)
  return {
    year,
    p10: percentile(ordered, 0.1),
    p25: percentile(ordered, 0.25),
    p50: percentile(ordered, 0.5),
    p75: percentile(ordered, 0.75),
    p90: percentile(ordered, 0.9),
  }
}

export function simulateScenario(
  analysis: Pick<
    PortfolioAnalysis,
    'value' | 'currentReturn' | 'targetReturn' | 'risk'
  >,
  inputs: ScenarioInputs,
  options: ScenarioSimulationOptions,
): ScenarioSimulation {
  const horizonYears = Math.max(1, Math.floor(options.horizonYears ?? 10))
  const paths = Math.max(100, Math.floor(options.paths ?? 2000))
  const seed = (options.seed ?? DEFAULT_SIMULATION_SEED) >>> 0
  const blendedReturn = Math.min(
    1,
    Math.max(
      -0.95,
      analysis.currentReturn * (1 - inputs.rebalance) +
        analysis.targetReturn * inputs.rebalance +
        inputs.returnAdj,
    ),
  )
  const blendedVolatility = Math.min(
    1,
    Math.max(
      0.001,
      analysis.risk.annualizedVolatility * (1 - inputs.rebalance) +
        analysis.risk.targetVolatility * inputs.rebalance,
    ),
  )
  const annualSamples = Array.from({ length: horizonYears + 1 }, () => [] as number[])
  const terminalValues: number[] = []
  const normal = normalGenerator(seed)
  const monthlyDrift = (blendedReturn - 0.5 * blendedVolatility ** 2) / 12
  const monthlyVolatility = blendedVolatility / Math.sqrt(12)

  for (let path = 0; path < paths; path++) {
    let value = analysis.value
    annualSamples[0].push(value)
    for (let month = 1; month <= horizonYears * 12; month++) {
      value = Math.max(
        0,
        value * Math.exp(monthlyDrift + monthlyVolatility * normal()) + inputs.contribution,
      )
      if (month % 12 === 0) annualSamples[month / 12].push(value)
    }
    terminalValues.push(value)
  }

  const points = annualSamples.map((values, year) => percentilePoint(year, values))
  const terminalPoint = points[points.length - 1]
  const contributedFloor = analysis.value + inputs.contribution * 12 * horizonYears
  const successCount = terminalValues.filter((value) => value >= options.goalValue).length
  const preserveCount = terminalValues.filter((value) => value >= contributedFloor).length

  return {
    blendedReturn,
    blendedVolatility,
    goalValue: options.goalValue,
    horizonYears,
    paths,
    seed,
    successProbability: successCount / paths,
    preserveContributionsProbability: preserveCount / paths,
    expectedTerminal: terminalValues.reduce((sum, value) => sum + value, 0) / paths,
    terminal: {
      p10: terminalPoint.p10,
      p25: terminalPoint.p25,
      p50: terminalPoint.p50,
      p75: terminalPoint.p75,
      p90: terminalPoint.p90,
    },
    points,
    assumptionDriven: true,
  }
}

export function optimizeContribution(
  analysis: Pick<
    PortfolioAnalysis,
    'value' | 'currentReturn' | 'targetReturn' | 'risk'
  >,
  inputs: Omit<ScenarioInputs, 'contribution'>,
  options: ContributionOptimizationOptions,
): ContributionOptimization {
  const horizonYears = options.horizonYears ?? 10
  const paths = options.paths ?? 800
  const seed = options.seed ?? DEFAULT_SIMULATION_SEED
  const maxContribution = options.maxContribution ?? 5000
  const contributionStep = options.contributionStep ?? 50
  const maxSteps = Math.max(1, Math.floor(maxContribution / contributionStep))
  const simulate = (contribution: number) =>
    simulateScenario(
      analysis,
      { ...inputs, contribution },
      { goalValue: options.goalValue, horizonYears, paths, seed },
    )

  const ceiling = simulate(maxSteps * contributionStep)
  if (ceiling.successProbability < options.targetProbability) {
    return {
      targetProbability: options.targetProbability,
      requiredContribution: maxSteps * contributionStep,
      achievedProbability: ceiling.successProbability,
      capped: true,
      maxContribution,
      contributionStep,
    }
  }

  let low = 0
  let high = maxSteps
  while (low < high) {
    const midpoint = Math.floor((low + high) / 2)
    const candidate = simulate(midpoint * contributionStep)
    if (candidate.successProbability >= options.targetProbability) high = midpoint
    else low = midpoint + 1
  }

  const requiredContribution = low * contributionStep
  const result = simulate(requiredContribution)
  return {
    targetProbability: options.targetProbability,
    requiredContribution,
    achievedProbability: result.successProbability,
    capped: false,
    maxContribution,
    contributionStep,
  }
}
