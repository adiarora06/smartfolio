// AI / explanation layer — the advisor.
//
// A prototype natural-language responder. It reads deterministic analysis +
// the current forecast and phrases an answer. This is the module that would be
// replaced by an LLM call (with the same context) in the production build.
//
// Per the compliance rule: educational framing only, never buy/sell advice.

import { fmt, pct, title } from '../format'
import type { PortfolioAnalysis } from '../calculations/portfolio'
import type { AdvisorScenarioContext } from '../calculations/scenario'
import type { AssistantSourceContext, StockForecast } from '../../types'
import { describeConcentrations, describeRecommendations } from './insights'

export interface AdvisorContext {
  analysis: PortfolioAnalysis
  stock: StockForecast
  scenario?: AdvisorScenarioContext
  sourceContext?: AssistantSourceContext
}

export function answerAdvisor(question: string, ctx: AdvisorContext): string {
  const { analysis, stock, scenario, sourceContext } = ctx
  const low = question.toLowerCase()

  if (
    scenario &&
    ['goal', 'probability', 'chance', 'monte', 'simulation', 'percentile'].some((term) =>
      low.includes(term),
    )
  ) {
    return `Across ${scenario.paths.toLocaleString()} assumption-driven paths, this plan reached ${fmt.format(
      scenario.goalValue,
    )} by year ${scenario.horizonYears} in ${pct(
      scenario.successProbability,
    )} of simulations. The modeled terminal median is ${fmt.format(
      scenario.p50,
    )}, with a 10th–90th percentile range of ${fmt.format(scenario.p10)} to ${fmt.format(
      scenario.p90,
    )}. Increasing contributions or lowering the target can improve that probability without assuming higher returns.`
  }

  if (
    sourceContext &&
    ['allocation_gap', 'rebalance_plan'].includes(sourceContext.kind) &&
    ['rebalance', 'allocation', 'gap', 'close'].some((term) => low.includes(term))
  ) {
    return `${sourceContext.summary} Direct future contributions toward the underweight assets first, then reassess before trimming concentrated positions. This lowers turnover while moving the portfolio toward its target.`
  }

  if (low.includes('stock') || low.includes('ticker') || low.includes(stock.symbol.toLowerCase())) {
    return `${stock.symbol} is rated ${stock.rating.toLowerCase()} in Analyze Stock, with median target ${fmt.format(
      stock.medianTarget,
    )} and expected return ${pct(stock.expected)}. Check ${title(
      stock.sector,
    )} concentration before adding.`
  }
  if (low.includes('rebalance')) {
    const evidence = sourceContext ? `${sourceContext.summary} ` : ''
    return `${evidence}Use future contributions first, then trim concentrated holdings if needed.`
  }
  if (['risk', 'volatility', 'var', 'drawdown'].some((term) => low.includes(term))) {
    const top = analysis.risk.topContributors[0]
    const topText = top
      ? ` ${top.label} contributes ${pct(top.riskContribution)} of modeled risk at ${pct(top.weight)} of capital.`
      : ''
    return `Modeled annual volatility is ${pct(analysis.risk.annualizedVolatility)}, using ${pct(
      analysis.risk.riskBudgetUsed,
    )} of the ${pct(analysis.risk.volCeiling)} profile budget.${topText}`
  }
  if (low.includes('connect')) {
    return 'Connect brokerage sync next so SmartFolio can analyze live holdings.'
  }

  const flags = describeConcentrations(analysis.concentrations)
  const recs = describeRecommendations(analysis.recommendations)
  return `${flags[0]} Suggested next step: ${recs[0] || 'keep monitoring allocation.'}`
}
