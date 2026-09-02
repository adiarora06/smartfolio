// Lightweight display projection and API result types.
//
// The seeded Monte Carlo engine and contribution optimizer live only in the
// Python backend (backend/app/services/scenario.py). The browser keeps this
// immediate projection for responsive slider feedback, then renders the
// authoritative distribution returned by the scenario-lab endpoint.

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

export interface ContributionOptimization {
  targetProbability: number
  requiredContribution: number
  achievedProbability: number
  capped: boolean
  maxContribution: number
  contributionStep: number
}

export const DEFAULT_SIMULATION_SEED = 20260806

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
