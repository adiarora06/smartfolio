import { useMemo, useState } from 'react'
import { buildFolioPath } from '../../lib/calculations/overview'
import { pct } from '../../lib/format'

const HORIZONS = [
  { label: '6M', years: 0.5 },
  { label: '1Y', years: 1 },
  { label: '5Y', years: 5 },
] as const

const W = 340
const H = 136
const PAD = { top: 18, right: 12, bottom: 22, left: 12 }

export function FolioPathChart({
  currentReturn,
  targetReturn,
}: {
  currentReturn: number
  targetReturn: number
}) {
  const [years, setYears] = useState(1)
  const points = useMemo(
    () => buildFolioPath(currentReturn, targetReturn, years),
    [currentReturn, targetReturn, years],
  )

  const min = Math.min(...points.map((point) => point.low))
  const max = Math.max(...points.map((point) => point.high))
  const span = max - min || 1
  const x = (progress: number) => PAD.left + progress * (W - PAD.left - PAD.right)
  const y = (value: number) => PAD.top + (1 - (value - min) / span) * (H - PAD.top - PAD.bottom)
  const line = (key: 'portfolio' | 'target' | 'low' | 'high') =>
    points.map((point, index) => `${index ? 'L' : 'M'}${x(point.progress)},${y(point[key])}`).join(' ')
  const corridor = [
    ...points.map((point) => `${x(point.progress)},${y(point.high)}`),
    ...points.slice().reverse().map((point) => `${x(point.progress)},${y(point.low)}`),
  ].join(' L')

  const end = points[points.length - 1]
  const modeledReturn = end.portfolio - 1

  return (
    <div className="folioChartWrap">
      <div className="folioChartHead">
        <div>
          <div className="folioEyebrow">Your Folio Path</div>
          <span className="folioRangeStatus">
            <span aria-hidden="true" /> Inside your growth range
          </span>
        </div>
        <div className="folioGrowthTag">Growth</div>
      </div>

      <svg
        className="folioPathChart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Modeled ${years}-year portfolio return ${pct(modeledReturn)} within the growth-profile planning range.`}
      >
        <path d={`M${corridor} Z`} className="folioCorridor" />
        <path d={line('low')} className="folioBoundary" />
        <path d={line('high')} className="folioBoundary" />
        <path d={line('target')} className="folioTargetLine" />
        <path d={line('portfolio')} className="folioPortfolioLine" />
        <circle cx={x(end.progress)} cy={y(end.portfolio)} r="4" className="folioEndpoint" />
        <text x={PAD.left} y={H - 4} className="folioAxisText">Today</text>
        <text x={W - PAD.right} y={H - 4} textAnchor="end" className="folioAxisText">
          {years < 1 ? '6 months' : `${years} year${years === 1 ? '' : 's'}`}
        </text>
      </svg>

      <div className="folioHorizon" aria-label="Projection horizon">
        {HORIZONS.map((horizon) => (
          <button
            key={horizon.label}
            type="button"
            className={years === horizon.years ? 'active' : undefined}
            aria-pressed={years === horizon.years}
            onClick={() => setYears(horizon.years)}
          >
            {horizon.label}
          </button>
        ))}
      </div>
      <p className="folioModelNote">Modeled range based on your allocation and risk profile.</p>
    </div>
  )
}
