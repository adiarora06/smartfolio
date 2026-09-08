import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { IonIcon } from '@ionic/react'
import { timeOutline } from 'ionicons/icons'
import type { PerformancePoint } from '../../../lib/calculations/performance'
import {
  buildHistorySeries,
  historyDatePositions,
  nearestHistoryPointIndex,
  type HistoryView,
} from '../../../lib/portfolioHistory'
import { fmt } from '../../../lib/format'

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' })

const displayDate = (value: string) => DATE_FORMATTER.format(new Date(`${value}T12:00:00`))
const axisDate = (value: string) => SHORT_DATE_FORMATTER.format(new Date(`${value}T12:00:00`))
const signedPercent = (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`

const chartValue = (value: number, view: HistoryView, axis = false) => {
  if (view === 'value') {
    if (!axis) return fmt.format(value)
    return Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : `$${Math.round(value)}`
  }
  if (view === 'performance') return axis ? value.toFixed(0) : signedPercent(value / 100 - 1)
  return `${(value * 100).toFixed(axis ? 0 : 1)}%`
}

const pathFrom = (
  values: number[],
  xForIndex: (index: number) => number,
  yForValue: (value: number) => number,
) => values
  .map((value, index) => `${index === 0 ? 'M' : 'L'} ${xForIndex(index).toFixed(1)} ${yForValue(value).toFixed(1)}`)
  .join(' ')

export function PortfolioHistoryChart({
  points,
  view,
  benchmarkSymbol,
}: {
  points: PerformancePoint[]
  view: HistoryView
  benchmarkSymbol: string
}) {
  const [cursorIndex, setCursorIndex] = useState<number | null>(null)
  const series = buildHistorySeries(points, view)

  if (series.length < 2) {
    return (
      <div className="historyChartEmpty" role="status">
        <IonIcon icon={timeOutline} />
        <strong>Not enough observations in this range</strong>
        <span>Choose a longer range or record another dated account value.</span>
      </div>
    )
  }

  const width = 800
  const height = 278
  const left = 62
  const right = 786
  const top = 18
  const bottom = 232
  const primary = series.map((point) => point.primary)
  const secondary = series.map((point) => point.secondary).filter((value): value is number => value != null)
  const allValues = [...primary, ...secondary, ...(view === 'drawdown' ? [0] : [])]
  const rawMin = Math.min(...allValues)
  const rawMax = Math.max(...allValues)
  const baseSpan = Math.max(rawMax - rawMin, view === 'value' ? Math.max(rawMax * 0.04, 1) : 1)
  const min = view === 'drawdown' ? Math.min(rawMin - baseSpan * 0.12, -0.01) : rawMin - baseSpan * 0.12
  const max = view === 'drawdown' ? 0 : rawMax + baseSpan * 0.12
  const span = Math.max(max - min, 0.0001)
  const datePositions = historyDatePositions(series)
  const xForIndex = (index: number) => left + datePositions[index] * (right - left)
  const yForValue = (value: number) => bottom - ((value - min) / span) * (bottom - top)
  const primaryPath = pathFrom(primary, xForIndex, yForValue)
  const secondaryPath = secondary.length === series.length
    ? pathFrom(secondary, xForIndex, yForValue)
    : ''
  const selectedIndex = Math.min(cursorIndex ?? series.length - 1, series.length - 1)
  const selected = series[selectedIndex]
  const selectedX = xForIndex(selectedIndex)
  const selectedY = yForValue(selected.primary)
  const secondaryLabel = view === 'performance' ? benchmarkSymbol : 'Net contributions'
  const primaryLabel = view === 'drawdown' ? 'Portfolio drawdown' : view === 'value' ? 'Portfolio value' : 'Portfolio estimate'
  const middleDateIndex = nearestHistoryPointIndex(series, 0.5)

  const moveCursor = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const svgX = ((event.clientX - bounds.left) / bounds.width) * width
    const ratio = Math.max(0, Math.min(1, (svgX - left) / (right - left)))
    setCursorIndex(nearestHistoryPointIndex(series, ratio))
  }

  const useKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    if (event.key === 'Home') return setCursorIndex(0)
    if (event.key === 'End') return setCursorIndex(series.length - 1)
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    setCursorIndex((current) => Math.max(0, Math.min(series.length - 1, (current ?? series.length - 1) + direction)))
  }

  return (
    <figure className={`historyChart historyChart--${view}`}>
      <div
        className="historyPlot"
        tabIndex={0}
        role="group"
        aria-label={`${primaryLabel} history. Use left and right arrow keys to inspect dates.`}
        onKeyDown={useKeyboard}
        onBlur={() => setCursorIndex(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${primaryLabel} from ${series[0].date} to ${series[series.length - 1].date}`}
          onPointerMove={moveCursor}
          onPointerLeave={() => setCursorIndex(null)}
        >
          <defs>
            <linearGradient id={`history-area-${view}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#48b9a8" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#48b9a8" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((step) => {
            const value = max - (step / 3) * span
            const y = top + (step / 3) * (bottom - top)
            return (
              <g key={step}>
                <line x1={left} y1={y} x2={right} y2={y} className="historyGridLine" />
                <text x={left - 10} y={y + 4} textAnchor="end">{chartValue(value, view, true)}</text>
              </g>
            )
          })}
          <path
            d={`${primaryPath} L ${right} ${bottom} L ${left} ${bottom} Z`}
            fill={`url(#history-area-${view})`}
            className="historyPrimaryArea"
          />
          {secondaryPath && <path d={secondaryPath} className="historySecondaryLine" />}
          <path d={primaryPath} className="historyPrimaryLine" />
          <line x1={selectedX} y1={top} x2={selectedX} y2={bottom} className="historyCursorLine" />
          <circle cx={selectedX} cy={selectedY} r="5" className="historyCursorDot" />
          <text x={left} y={height - 15}>{axisDate(series[0].date)}</text>
          <text x={(left + right) / 2} y={height - 15} textAnchor="middle">{axisDate(series[middleDateIndex].date)}</text>
          <text x={right} y={height - 15} textAnchor="end">{axisDate(series[series.length - 1].date)}</text>
        </svg>

        <div
          className={`historyTooltip ${selectedX > (left + right) / 2 ? 'alignRight' : ''}`}
          style={{ left: `${(selectedX / width) * 100}%` }}
          aria-live="polite"
        >
          <small>{displayDate(selected.date)}</small>
          <span><i className="primary" />{primaryLabel}<strong>{chartValue(selected.primary, view)}</strong></span>
          {selected.secondary != null && (
            <span><i className="secondary" />{secondaryLabel}<strong>{chartValue(selected.secondary, view)}</strong></span>
          )}
        </div>
      </div>
      <figcaption>
        <span><i className="primary" />{primaryLabel}</span>
        {secondaryPath && <span><i className="secondary" />{secondaryLabel}</span>}
        <span>Hover or use arrow keys</span>
      </figcaption>
    </figure>
  )
}
