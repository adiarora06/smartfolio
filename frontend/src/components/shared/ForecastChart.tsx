// Forecast chart — bear / median / bull paths.
// Ported from the prototype's chart() SVG generator.

import { fmt } from '../../lib/format'
import type { ForecastPoint, StockForecast } from '../../types'

export function ForecastChart({ forecast }: { forecast: StockForecast }) {
  const w = 720
  const h = 260
  const vals = forecast.paths.flatMap((p) => [p.bear, p.median, p.bull])
  const min = Math.min(...vals) * 0.985
  const max = Math.max(...vals) * 1.015

  const points = (k: keyof ForecastPoint): string =>
    forecast.paths
      .map(
        (p, i) =>
          `${34 + (i / (forecast.paths.length - 1)) * (w - 58)},${
            18 + (1 - (p[k] - min) / (max - min)) * (h - 42)
          }`,
      )
      .join(' ')

  return (
    <svg className="svgbox" viewBox={`0 0 ${w} ${h}`}>
      <line x1="34" y1="218" x2="680" y2="218" stroke="rgba(255,255,255,.16)" />
      <line x1="34" y1="36" x2="34" y2="218" stroke="rgba(255,255,255,.16)" />
      <polyline points={points('bull')} fill="none" stroke="#60a5fa" strokeWidth="2" strokeDasharray="5 5" />
      <polyline points={points('bear')} fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="5 5" />
      <polyline points={points('median')} fill="none" stroke="#5eead4" strokeWidth="4" />
      <text x="38" y="26" fill="#93c5fd" fontSize="12">
        Bull {fmt.format(forecast.bullTarget)}
      </text>
      <text x="38" y="242" fill="#93c5fd" fontSize="12">
        Bear {fmt.format(forecast.bearTarget)}
      </text>
    </svg>
  )
}
