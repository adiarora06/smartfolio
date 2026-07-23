// AI / explanation layer — stock research memos.
//
// Turns a deterministic StockForecast into natural-language memo text.
// The forecast numbers come from lib/calculations/stock.ts; this module only
// narrates them. This is where an LLM-generated memo would slot in.

import { fmt, pct, title } from '../format'
import type { StockForecast } from '../../types'

/**
 * The research memo shown on the forecast tab.
 *
 * Every line is phrased as a property of the fitted distribution rather than a
 * claim about what the stock will do, and lines implying measurement are only
 * emitted when the underlying input was actually measured.
 */
export function buildForecastMemo(f: StockForecast): string[] {
  const lines = [
    `${f.symbol} maps to a ${f.rating.toLowerCase()} setup over ${f.days} days, with a ` +
      `modelled ${pct(f.probGain)} chance of finishing above today's price.`,
    `The central 50% of the modelled range runs ${fmt.format(f.q25Target)} to ` +
      `${fmt.format(f.q75Target)}, around a median of ${fmt.format(f.medianTarget)}; ` +
      `the 5th–95th percentile range is ${fmt.format(f.bearTarget)} to ${fmt.format(f.bullTarget)}.`,
  ]

  if (f.inputs) {
    const basis = f.inputs.volMeasured
      ? `${pct(f.inputs.sigma)} annualized volatility measured from price history`
      : `an assumed ${pct(f.inputs.sigma)} annualized volatility (no history available)`
    lines.push(
      `The band is built from ${basis}, with a drift estimate of ${pct(f.inputs.mu)} after ` +
        `shrinking ${pct(1 - f.inputs.shrinkage)} of the raw signal toward a market baseline.`,
    )
  }

  if (f.probDrawdown20 > 0.1) {
    lines.push(
      `The same model puts a ${pct(f.probDrawdown20)} chance of a 20% drawdown at some ` +
        `point within the horizon, and ${pct(f.probDrawdown10)} for a 10% drawdown.`,
    )
  }

  lines.push(`Check ${title(f.sector)} exposure before adding more.`)
  return lines
}

/** The compact one-line memo stored in Analyze Stock memory. */
export function buildSavedMemo(f: StockForecast): string {
  return `${f.days} day median target ${fmt.format(f.medianTarget)}, expected ${pct(f.expected)}.`
}
