// Forecast fan chart — the confidence cone.
//
// Two shaded bands and a median line, all read off the same fitted lognormal:
//   - outer band  5th-95th percentile  (90% of the modelled mass)
//   - inner band 25th-75th percentile  (the interquartile range, 50% of mass)
//   - median line 50th percentile
//
// The bands open from a single point at today's price and widen with sqrt(t),
// which is the visual signature of a real distribution rather than a pair of
// scenario lines. Reading it: half the modelled outcomes fall inside the dark
// band, nine in ten inside the light one.

import { useId, useState } from 'react'
import { fmt, pct } from '../../lib/format'
import type { StockForecast } from '../../types'

const W = 760
const H = 320
const PAD = { top: 22, right: 74, bottom: 34, left: 56 }

const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

export function ForecastChart({ forecast }: { forecast: StockForecast }) {
  const gradientId = useId()
  const [hover, setHover] = useState<number | null>(null)

  const points = forecast.paths
  if (points.length < 2) return null

  // Scale to the outer band plus the anchor price, so the spot line is always
  // on-chart even when the whole cone drifts away from it.
  const lows = points.map((p) => p.q05)
  const highs = points.map((p) => p.q95)
  const min = Math.min(...lows, forecast.price) * 0.98
  const max = Math.max(...highs, forecast.price) * 1.02
  const span = max - min || 1

  const x = (i: number) => PAD.left + (i / (points.length - 1)) * PLOT_W
  const y = (v: number) => PAD.top + (1 - (v - min) / span) * PLOT_H

  /** Closed polygon between two quantile series — the shaded band. */
  const band = (lo: (i: number) => number, hi: (i: number) => number): string => {
    const up = points.map((_, i) => `${x(i)},${y(hi(i))}`)
    const down = points.map((_, i) => `${x(i)},${y(lo(i))}`).reverse()
    return `M${up.join(' L')} L${down.join(' L')} Z`
  }

  const line = (get: (i: number) => number): string =>
    points.map((_, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(get(i))}`).join(' ')

  // Y gridlines at quarter intervals of the visible range.
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4)

  const active = hover === null ? points.length - 1 : hover
  const cursor = points[active]

  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="svgbox"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={
          `${forecast.symbol} forecast cone over ${forecast.days} days. ` +
          `Median ${fmt.format(forecast.medianTarget)}, ` +
          `interquartile range ${fmt.format(forecast.q25Target)} to ${fmt.format(forecast.q75Target)}, ` +
          `5th to 95th percentile ${fmt.format(forecast.bearTarget)} to ${fmt.format(forecast.bullTarget)}.`
        }
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${gradientId}-outer`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.22" />
          </linearGradient>
          <linearGradient id={`${gradientId}-inner`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#5eead4" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#5eead4" stopOpacity="0.38" />
          </linearGradient>
        </defs>

        {ticks.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              y1={y(v)}
              x2={PAD.left + PLOT_W}
              y2={y(v)}
              stroke="rgba(255,255,255,.07)"
            />
            <text x={PAD.left - 8} y={y(v) + 4} fill="#93c5fd" fontSize="11" textAnchor="end">
              {fmt.format(v)}
            </text>
          </g>
        ))}

        {/* Today's price — the line the whole cone is relative to. */}
        <line
          x1={PAD.left}
          y1={y(forecast.price)}
          x2={PAD.left + PLOT_W}
          y2={y(forecast.price)}
          stroke="rgba(255,255,255,.34)"
          strokeDasharray="4 4"
        />

        <path d={band((i) => points[i].q05, (i) => points[i].q95)} fill={`url(#${gradientId}-outer)`} />
        <path d={band((i) => points[i].q25, (i) => points[i].q75)} fill={`url(#${gradientId}-inner)`} />

        <path d={line((i) => points[i].q25)} fill="none" stroke="#5eead4" strokeWidth="1" strokeOpacity="0.55" />
        <path d={line((i) => points[i].q75)} fill="none" stroke="#5eead4" strokeWidth="1" strokeOpacity="0.55" />
        <path d={line((i) => points[i].q50)} fill="none" stroke="#5eead4" strokeWidth="2.5" />

        {/* Right-edge labels for the terminal quantiles. */}
        <text x={PAD.left + PLOT_W + 6} y={y(points[points.length - 1].q95) + 4} fill="#93c5fd" fontSize="11">
          95th
        </text>
        <text x={PAD.left + PLOT_W + 6} y={y(points[points.length - 1].q75) + 4} fill="#5eead4" fontSize="11">
          75th
        </text>
        <text x={PAD.left + PLOT_W + 6} y={y(points[points.length - 1].q50) + 4} fill="#5eead4" fontSize="11" fontWeight="700">
          50th
        </text>
        <text x={PAD.left + PLOT_W + 6} y={y(points[points.length - 1].q25) + 4} fill="#5eead4" fontSize="11">
          25th
        </text>
        <text x={PAD.left + PLOT_W + 6} y={y(points[points.length - 1].q05) + 4} fill="#93c5fd" fontSize="11">
          5th
        </text>

        {/* Hover readout. */}
        <line
          x1={x(active)}
          y1={PAD.top}
          x2={x(active)}
          y2={PAD.top + PLOT_H}
          stroke="rgba(255,255,255,.28)"
        />
        <circle cx={x(active)} cy={y(cursor.q50)} r="3.5" fill="#5eead4" />

        <text x={PAD.left} y={H - 10} fill="#93c5fd" fontSize="11">
          today
        </text>
        <text x={PAD.left + PLOT_W} y={H - 10} fill="#93c5fd" fontSize="11" textAnchor="end">
          +{Math.round(forecast.days)}d
        </text>

        {/* Invisible hit targets, drawn last so they sit above the bands. */}
        {points.map((_, i) => (
          <rect
            key={i}
            x={x(i) - PLOT_W / (points.length - 1) / 2}
            y={PAD.top}
            width={PLOT_W / (points.length - 1)}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      <figcaption
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          fontSize: 12,
          color: 'var(--muted)',
          paddingTop: 6,
        }}
      >
        <span>
          <strong style={{ color: '#5eead4' }}>Day {Math.round(cursor.day)}</strong> · median{' '}
          {fmt.format(cursor.q50)}
        </span>
        <span>
          50% band {fmt.format(cursor.q25)} – {fmt.format(cursor.q75)}
        </span>
        <span>
          90% band {fmt.format(cursor.q05)} – {fmt.format(cursor.q95)}
        </span>
        <span style={{ opacity: 0.75 }}>
          σ {pct(forecast.annualizedVol || forecast.vol)} annualized
          {forecast.inputs && !forecast.inputs.volMeasured ? ' (reference estimate)' : ' (measured)'}
        </span>
      </figcaption>
    </figure>
  )
}
