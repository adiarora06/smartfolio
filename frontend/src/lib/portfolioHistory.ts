import type { PerformancePoint } from './calculations/performance'

export type HistoryRange = '3m' | '6m' | '1y' | 'all'
export type HistoryView = 'performance' | 'value' | 'drawdown'

export interface HistoryDisplayPoint extends PerformancePoint {
  primary: number
  secondary: number | null
  drawdown: number
}

export interface HistoryPeriodSummary {
  measured: boolean
  portfolioReturn: number | null
  benchmarkReturn: number | null
  excessReturn: number | null
  maxDrawdown: number | null
  startValue: number | null
  endValue: number | null
  observations: number
  benchmarkObservations: number
  startDate: string | null
  endDate: string | null
}

const monthsForRange: Record<Exclude<HistoryRange, 'all'>, number> = {
  '3m': 3,
  '6m': 6,
  '1y': 12,
}

const dateNumber = (date: string) => new Date(`${date}T12:00:00Z`).getTime()

/** Normalize dated observations onto a 0..1 time axis. Unevenly spaced
 * valuations must remain uneven on the chart or sparse periods look denser
 * than they really are. */
export function historyDatePositions(points: Array<Pick<PerformancePoint, 'date'>>): number[] {
  if (points.length < 2) return points.map(() => 0)
  const dates = points.map((point) => dateNumber(point.date))
  const start = dates[0]
  const span = dates[dates.length - 1] - start
  if (!dates.every(Number.isFinite) || !Number.isFinite(span) || span <= 0) {
    return points.map((_, index) => index / (points.length - 1))
  }
  return dates.map((value) => (value - start) / span)
}

/** Find the observation nearest a pointer's normalized position on the time
 * axis. Ties resolve to the earlier point for deterministic keyboard/pointer
 * handoff. */
export function nearestHistoryPointIndex(
  points: Array<Pick<PerformancePoint, 'date'>>,
  position: number,
): number {
  if (!points.length) return -1
  const target = Math.max(0, Math.min(1, position))
  const positions = historyDatePositions(points)
  let nearest = 0
  let distance = Math.abs(positions[0] - target)
  for (let index = 1; index < positions.length; index += 1) {
    const nextDistance = Math.abs(positions[index] - target)
    if (nextDistance < distance) {
      nearest = index
      distance = nextDistance
    }
  }
  return nearest
}

const subtractUtcMonths = (value: Date, months: number): Date => {
  const result = new Date(value)
  const originalDay = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() - months)
  const finalDay = new Date(Date.UTC(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    0,
  )).getUTCDate()
  result.setUTCDate(Math.min(originalDay, finalDay))
  return result
}

export function filterHistoryPoints(
  points: PerformancePoint[],
  range: HistoryRange,
): PerformancePoint[] {
  if (range === 'all' || points.length === 0) return points
  const end = new Date(`${points[points.length - 1].date}T12:00:00Z`)
  const cutoff = subtractUtcMonths(end, monthsForRange[range]).getTime()
  return points.filter((point) => dateNumber(point.date) >= cutoff)
}

export function summarizeHistory(points: PerformancePoint[]): HistoryPeriodSummary {
  const first = points[0]
  const last = points[points.length - 1]
  const measured = points.length >= 2
  const portfolioReturn = measured && first.portfolioIndex > 0
    ? last.portfolioIndex / first.portfolioIndex - 1
    : null
  const benchmarkReturn = measured && first.benchmarkIndex && last.benchmarkIndex
    ? last.benchmarkIndex / first.benchmarkIndex - 1
    : null

  let peak = first?.portfolioIndex ?? 0
  let maxDrawdown = 0
  points.forEach((point) => {
    peak = Math.max(peak, point.portfolioIndex)
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, point.portfolioIndex / peak - 1)
  })

  return {
    measured,
    portfolioReturn,
    benchmarkReturn,
    excessReturn:
      portfolioReturn != null && benchmarkReturn != null
        ? portfolioReturn - benchmarkReturn
        : null,
    maxDrawdown: measured ? maxDrawdown : null,
    startValue: first?.value ?? null,
    endValue: last?.value ?? null,
    observations: points.length,
    benchmarkObservations: points.filter((point) => point.benchmarkIndex != null).length,
    startDate: first?.date ?? null,
    endDate: last?.date ?? null,
  }
}

export function buildHistorySeries(
  points: PerformancePoint[],
  view: HistoryView,
): HistoryDisplayPoint[] {
  if (!points.length) return []
  const portfolioBase = points[0].portfolioIndex || 1
  const benchmarkBase = points[0].benchmarkIndex
  let peak = portfolioBase

  return points.map((point) => {
    peak = Math.max(peak, point.portfolioIndex)
    const drawdown = peak > 0 ? point.portfolioIndex / peak - 1 : 0
    if (view === 'value') {
      return {
        ...point,
        primary: point.value,
        secondary: point.cumulativeContributions,
        drawdown,
      }
    }
    if (view === 'drawdown') {
      return { ...point, primary: drawdown, secondary: null, drawdown }
    }
    return {
      ...point,
      primary: (point.portfolioIndex / portfolioBase) * 100,
      secondary:
        benchmarkBase && point.benchmarkIndex != null
          ? (point.benchmarkIndex / benchmarkBase) * 100
          : null,
      drawdown,
    }
  })
}
