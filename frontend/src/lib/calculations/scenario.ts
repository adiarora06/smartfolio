// Deterministic scenario projection.
//
// Blends the current and target allocation returns, applies a manual return
// adjustment, and compounds monthly contributions over 1/5/10 years.

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
