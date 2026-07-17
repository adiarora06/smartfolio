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
}

export function projectScenario(
  analysis: Pick<PortfolioAnalysis, 'value' | 'currentReturn' | 'targetReturn'>,
  inputs: ScenarioInputs,
): ScenarioProjection {
  const blendedReturn =
    analysis.currentReturn * (1 - inputs.rebalance) +
    analysis.targetReturn * inputs.rebalance +
    inputs.returnAdj

  const compound = (years: number): number => {
    let v = analysis.value
    const monthly = Math.pow(1 + blendedReturn, 1 / 12) - 1
    for (let i = 0; i < years * 12; i++) v = v * (1 + monthly) + inputs.contribution
    return v
  }

  return {
    blendedReturn,
    points: [1, 5, 10].map((years) => ({ years, value: compound(years) })),
  }
}
