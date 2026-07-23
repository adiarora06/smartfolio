// AI / explanation layer — portfolio insights.
//
// Converts the *structured findings* from the deterministic engine
// (lib/calculations/portfolio.ts) into user-facing sentences. Today this is
// deterministic templating; in the production architecture this is the seam
// where an LLM would generate the narrative from the same structured inputs.
//
// Nothing here computes financial values — it only phrases them.

import { fmt, pct, title } from '../format'
import type {
  ConcentrationFinding,
  PortfolioAnalysis,
  RecommendationSignal,
} from '../calculations/portfolio'
import type { PortfolioImpact } from '../../types'

/** Phrase concentration findings as warning sentences. */
export function describeConcentrations(findings: ConcentrationFinding[]): string[] {
  if (!findings.length) return ['No major concentration flags found.']
  return findings.map((f) => {
    switch (f.kind) {
      case 'single_stock':
        return `${f.label} is ${pct(f.weight)} of the portfolio, a high single-stock concentration.`
      case 'stock_aggregate':
        return `Individual stocks are ${pct(f.weight)} of the portfolio.`
      case 'sector':
        return `${title(f.label)} exposure is ${pct(f.weight)}, creating sector concentration risk.`
    }
  })
}

/** Phrase recommendation signals as next-step sentences. */
export function describeRecommendations(signals: RecommendationSignal[]): string[] {
  return signals.map((s) => {
    switch (s.kind) {
      case 'increase':
        return `Increase ${(s.asset ?? '').replaceAll('_', ' ')} exposure over time.`
      case 'reduce':
        return `Reduce ${(s.asset ?? '').replaceAll('_', ' ')} concentration over time.`
      case 'diversify_single_stock':
        return 'Use broader funds or future contributions to reduce single-stock dependency.'
    }
  })
}

/** Phrase the what-if impact findings. Mirror of the backend's describe_impact. */
export function describeImpact(impact: PortfolioImpact, symbol: string): string[] {
  const first =
    `Adding ${fmt.format(impact.addedValue)} of ${symbol} would make it ` +
    `${pct(impact.newWeight)} of your portfolio` +
    (impact.triggersSingleStockFlag
      ? ', triggering a single-stock concentration flag.'
      : '.')
  const second =
    `${title(impact.sector)} exposure would move to ${pct(impact.sectorWeightAfter)}` +
    (impact.triggersSectorFlag ? ', crossing the sector concentration threshold.' : '.')
  const out = [first, second]

  if (impact.volAfter > 0) {
    const direction = impact.volDelta > 0 ? 'up' : 'down'
    out.push(
      `Estimated portfolio volatility moves ${direction} from ${pct(impact.volBefore)} to ` +
        `${pct(impact.volAfter)} annualized, and portfolio beta from ` +
        `${impact.betaBefore.toFixed(2)} to ${impact.betaAfter.toFixed(2)}.`,
    )
    // The weight/risk gap is the finding a weights-only view cannot show.
    if (impact.riskContribution > impact.newWeight * 1.25) {
      out.push(
        `At ${pct(impact.newWeight)} of value the position would carry ` +
          `${pct(impact.riskContribution)} of total portfolio risk — its volatility makes it ` +
          `a larger risk position than a weight view suggests.`,
      )
    }
    out.push(
      `A 95% confidence loss estimate over the same horizon moves from ` +
        `${pct(impact.var95Before)} to ${pct(impact.var95After)} of portfolio value.`,
    )
    if (impact.maxWeightForProfile > 0) {
      out.push(
        `Staying inside the ${pct(impact.volCeiling)} volatility ceiling for this risk profile ` +
          `implies a position of at most ${pct(impact.maxWeightForProfile)} of the portfolio.`,
      )
    }
    out.push(
      impact.improvesRiskAdjustedReturn
        ? 'Return per unit of risk improves on these assumptions.'
        : 'Return per unit of risk does not improve on these assumptions.',
    )
  }
  return out
}

export interface PortfolioInsights {
  flags: string[]
  recommendations: string[]
}

/** Convenience: render both flag and recommendation prose for an analysis. */
export function describeInsights(analysis: PortfolioAnalysis): PortfolioInsights {
  return {
    flags: describeConcentrations(analysis.concentrations),
    recommendations: describeRecommendations(analysis.recommendations),
  }
}
