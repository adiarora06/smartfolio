// AI / explanation layer — stock research memos.
//
// Turns a deterministic StockForecast into natural-language memo text.
// The forecast numbers come from lib/calculations/stock.ts; this module only
// narrates them. This is where an LLM-generated memo would slot in.

import { fmt, pct, title } from '../format'
import type { StockForecast } from '../../types'

/** The three-line research memo shown on the forecast tab. */
export function buildForecastMemo(f: StockForecast): string[] {
  return [
    `${f.symbol} maps to a ${f.rating.toLowerCase()} setup over ${f.days} days.`,
    `Median target is ${fmt.format(f.medianTarget)}, with range ${fmt.format(
      f.bearTarget,
    )} to ${fmt.format(f.bullTarget)}.`,
    `Check ${title(f.sector)} exposure before adding more.`,
  ]
}

/** The compact one-line memo stored in Analyze Stock memory. */
export function buildSavedMemo(f: StockForecast): string {
  return `${f.days} day median target ${fmt.format(f.medianTarget)}, expected ${pct(f.expected)}.`
}
