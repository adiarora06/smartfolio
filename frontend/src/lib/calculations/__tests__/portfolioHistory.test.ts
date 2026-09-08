import { describe, expect, it } from 'vitest'
import type { PerformancePoint } from '../performance'
import {
  buildHistorySeries,
  filterHistoryPoints,
  historyDatePositions,
  nearestHistoryPointIndex,
  summarizeHistory,
} from '../../portfolioHistory'

const points: PerformancePoint[] = [
  { date: '2025-01-01', value: 10000, cumulativeContributions: 10000, portfolioIndex: 100, benchmarkIndex: 100 },
  { date: '2025-07-01', value: 11200, cumulativeContributions: 10500, portfolioIndex: 107, benchmarkIndex: 106 },
  { date: '2026-01-01', value: 10400, cumulativeContributions: 10500, portfolioIndex: 99, benchmarkIndex: 110 },
  { date: '2026-07-01', value: 12500, cumulativeContributions: 11000, portfolioIndex: 116, benchmarkIndex: 114 },
]

describe('portfolio history presentation', () => {
  it('filters ranges from the last observed valuation date', () => {
    expect(filterHistoryPoints(points, '1y').map((point) => point.date)).toEqual([
      '2025-07-01',
      '2026-01-01',
      '2026-07-01',
    ])
    expect(filterHistoryPoints(points, '3m')).toEqual([points[3]])
    expect(filterHistoryPoints(points, 'all')).toEqual(points)
  })

  it('clamps month-end range cutoffs instead of rolling into the next month', () => {
    const monthEndPoints: PerformancePoint[] = [
      { date: '2026-02-28', value: 100, cumulativeContributions: 100, portfolioIndex: 100, benchmarkIndex: 100 },
      { date: '2026-08-31', value: 110, cumulativeContributions: 100, portfolioIndex: 110, benchmarkIndex: 108 },
    ]

    expect(filterHistoryPoints(monthEndPoints, '6m')).toEqual(monthEndPoints)
  })

  it('positions observations by elapsed time and selects the nearest date', () => {
    const uneven = [
      { date: '2026-01-01' },
      { date: '2026-01-11' },
      { date: '2026-04-11' },
    ]

    expect(historyDatePositions(uneven)).toEqual([0, 0.1, 1])
    expect(nearestHistoryPointIndex(uneven, 0.04)).toBe(0)
    expect(nearestHistoryPointIndex(uneven, 0.4)).toBe(1)
    expect(nearestHistoryPointIndex(uneven, 0.7)).toBe(2)
    expect(nearestHistoryPointIndex(uneven, -1)).toBe(0)
    expect(nearestHistoryPointIndex(uneven, 2)).toBe(2)
  })

  it('rebases estimated portfolio and benchmark performance to the selected period', () => {
    const series = buildHistorySeries(points.slice(1), 'performance')
    expect(series[0].primary).toBe(100)
    expect(series[0].secondary).toBe(100)
    expect(series[2].primary).toBeCloseTo((116 / 107) * 100)
    expect(series[2].secondary).toBeCloseTo((114 / 106) * 100)
  })

  it('shows observed value against cumulative external contributions', () => {
    const series = buildHistorySeries(points, 'value')
    expect(series[2].primary).toBe(10400)
    expect(series[2].secondary).toBe(10500)
  })

  it('calculates drawdown relative to the peak inside the selected range', () => {
    const series = buildHistorySeries(points, 'drawdown')
    expect(series[0].primary).toBe(0)
    expect(series[2].primary).toBeCloseTo(99 / 107 - 1)
    expect(series[3].primary).toBe(0)
  })

  it('summarizes a selected period without overstating sparse coverage', () => {
    const summary = summarizeHistory(points.slice(1))
    expect(summary.measured).toBe(true)
    expect(summary.portfolioReturn).toBeCloseTo(116 / 107 - 1)
    expect(summary.benchmarkReturn).toBeCloseTo(114 / 106 - 1)
    expect(summary.maxDrawdown).toBeCloseTo(99 / 107 - 1)
    expect(summary.observations).toBe(3)
  })

  it('does not claim a period return from one observation', () => {
    const summary = summarizeHistory([points[3]])
    expect(summary.measured).toBe(false)
    expect(summary.portfolioReturn).toBeNull()
    expect(summary.maxDrawdown).toBeNull()
  })
})
