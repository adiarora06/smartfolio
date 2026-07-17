// AI / explanation layer — portfolio insights.
//
// Converts the *structured findings* from the deterministic engine
// (lib/calculations/portfolio.ts) into user-facing sentences. Today this is
// deterministic templating; in the production architecture this is the seam
// where an LLM would generate the narrative from the same structured inputs.
//
// Nothing here computes financial values — it only phrases them.

import { pct, title } from '../format'
import type {
  ConcentrationFinding,
  PortfolioAnalysis,
  RecommendationSignal,
} from '../calculations/portfolio'

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
