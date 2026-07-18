// AI / explanation layer — the advisor.
//
// A prototype natural-language responder. It reads deterministic analysis +
// the current forecast and phrases an answer. This is the module that would be
// replaced by an LLM call (with the same context) in the production build.
//
// Per the compliance rule: educational framing only, never buy/sell advice.

import { fmt, pct, title } from '../format'
import type { PortfolioAnalysis } from '../calculations/portfolio'
import type { StockForecast } from '../../types'
import { describeConcentrations, describeRecommendations } from './insights'

export interface AdvisorContext {
  analysis: PortfolioAnalysis
  stock: StockForecast
}

export function answerAdvisor(question: string, ctx: AdvisorContext): string {
  const { analysis, stock } = ctx
  const low = question.toLowerCase()

  if (low.includes('stock') || low.includes('ticker') || low.includes(stock.symbol.toLowerCase())) {
    return `${stock.symbol} is rated ${stock.rating.toLowerCase()} in Analyze Stock, with median target ${fmt.format(
      stock.medianTarget,
    )} and expected return ${pct(stock.expected)}. Check ${title(
      stock.sector,
    )} concentration before adding.`
  }
  if (low.includes('rebalance')) {
    return 'Use future contributions first, then trim concentrated holdings if needed.'
  }
  if (low.includes('connect')) {
    return 'Connect brokerage sync next so SmartFolio can analyze live holdings.'
  }

  const flags = describeConcentrations(analysis.concentrations)
  const recs = describeRecommendations(analysis.recommendations)
  return `${flags[0]} Suggested next step: ${recs[0] || 'keep monitoring allocation.'}`
}
