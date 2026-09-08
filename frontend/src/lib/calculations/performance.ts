import type { PortfolioTransaction, ValuationSnapshot } from '../../types'

export interface PerformancePoint {
  date: string
  value: number
  cumulativeContributions: number
  portfolioIndex: number
  benchmarkIndex: number | null
  /** Canonical backend history fields. Local fallback points omit these. */
  externalFlow?: number
  periodReturn?: number | null
  drawdown?: number
}

export type PerformanceRangePreset = '1m' | '3m' | '6m' | 'ytd' | '1y' | 'all' | 'custom'

export interface PerformanceRangeRequest {
  preset: PerformanceRangePreset
  startDate?: string
  endDate?: string
}

export interface PerformanceCoverage {
  calculationStatus: 'unavailable' | 'partial' | 'complete'
  valuationPoints: number
  intervalCount: number
  validIntervalCount: number
  externalFlowCount: number
  medianValuationGapDays: number | null
  ledgerCompleteness: 'unknown'
  benchmarkSummary: 'none' | 'complete'
  benchmarkSeries: 'none' | 'partial' | 'complete'
  drawdown: 'snapshot_only'
  allocationHistory: 'none'
  attribution: 'none'
}

export interface PerformanceWarning {
  code: string
  message: string
  dates: string[]
}

export interface PerformanceSummary {
  measured: boolean
  benchmarkSymbol: string
  startDate: string | null
  endDate: string | null
  currentValue: number
  netContributions: number
  gain: number | null
  totalReturn: number | null
  benchmarkReturn: number | null
  excessReturn: number | null
  maxDrawdown: number | null
  observations: number
  source: 'demo' | 'imported' | 'manual' | 'mixed'
  points: PerformancePoint[]
  /** Range-aware backend metrics. Optional while the explicit offline fallback is active. */
  method?: 'modified_dietz'
  precision?: 'estimated'
  flowTimingAssumption?: 'date_weighted_end_of_day'
  requestedRange?: {
    preset: PerformanceRangePreset
    startDate: string | null
    endDate: string | null
  }
  effectiveRange?: {
    startDate: string | null
    endDate: string | null
    dayCount: number
  }
  estimatedReturn?: number | null
  annualizedReturn?: number | null
  netExternalFlow?: number
  investmentGain?: number | null
  currentDrawdown?: number | null
  coverage?: PerformanceCoverage
  intervals?: Array<{
    startDate: string
    endDate: string
    dayCount: number
    externalFlow: number
    weightedExternalFlow: number
    returnValue: number | null
    valid: boolean
  }>
  warnings?: PerformanceWarning[]
}

const externalFlow = (transaction: PortfolioTransaction): number => {
  if (transaction.type === 'deposit') return transaction.amount
  if (transaction.type === 'withdrawal') return -transaction.amount
  return 0
}

function sourceLabel(snapshots: ValuationSnapshot[]): PerformanceSummary['source'] {
  const sources = new Set(snapshots.map((snapshot) => snapshot.source))
  if (sources.size !== 1) return 'mixed'
  return snapshots[0]?.source ?? 'manual'
}

/** Explicit offline fallback for the static build. It assigns each external
 * cash flow to the end of its valuation interval; the backend's date-weighted
 * Modified Dietz result is canonical whenever the API is reachable. */
export function calculatePerformance(
  transactions: PortfolioTransaction[],
  valuations: ValuationSnapshot[],
): PerformanceSummary {
  const snapshots = [...valuations]
    .filter((snapshot) => snapshot.value >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  const activity = [...transactions].sort((a, b) => a.date.localeCompare(b.date))
  const benchmarkSymbol =
    snapshots.find((snapshot) => snapshot.benchmarkSymbol)?.benchmarkSymbol || 'VOO'
  const latestSnapshot = snapshots[snapshots.length - 1]
  const endDate = latestSnapshot?.date ?? null
  const netContributions = activity
    .filter((transaction) => !endDate || transaction.date <= endDate)
    .reduce((sum, transaction) => sum + externalFlow(transaction), 0)
  const currentValue = latestSnapshot?.value ?? 0
  const gain = currentValue - netContributions

  if (!snapshots.length) {
    return {
      measured: false,
      benchmarkSymbol,
      startDate: null,
      endDate: null,
      currentValue: 0,
      netContributions,
      gain: -netContributions,
      totalReturn: 0,
      benchmarkReturn: null,
      excessReturn: null,
      maxDrawdown: 0,
      observations: 0,
      source: 'manual',
      points: [],
    }
  }

  let portfolioIndex = 100
  let peak = portfolioIndex
  let maxDrawdown = 0
  let cumulativeContributions = activity
    .filter((transaction) => transaction.date <= snapshots[0].date)
    .reduce((sum, transaction) => sum + externalFlow(transaction), 0)
  const benchmarkStart = snapshots[0].benchmarkValue
  const points: PerformancePoint[] = [
    {
      date: snapshots[0].date,
      value: snapshots[0].value,
      cumulativeContributions,
      portfolioIndex,
      benchmarkIndex: benchmarkStart && benchmarkStart > 0 ? 100 : null,
    },
  ]

  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1]
    const current = snapshots[index]
    const flow = activity
      .filter(
        (transaction) => transaction.date > previous.date && transaction.date <= current.date,
      )
      .reduce((sum, transaction) => sum + externalFlow(transaction), 0)
    cumulativeContributions += flow
    const segmentReturn = previous.value > 0 ? (current.value - flow) / previous.value - 1 : 0
    portfolioIndex *= Math.max(0, 1 + segmentReturn)
    peak = Math.max(peak, portfolioIndex)
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, portfolioIndex / peak - 1)
    points.push({
      date: current.date,
      value: current.value,
      cumulativeContributions,
      portfolioIndex,
      benchmarkIndex:
        benchmarkStart && benchmarkStart > 0 && current.benchmarkValue
          ? (current.benchmarkValue / benchmarkStart) * 100
          : null,
    })
  }

  const measured = snapshots.length >= 2
  const totalReturn = measured ? portfolioIndex / 100 - 1 : 0
  const benchmarkEnd = latestSnapshot?.benchmarkValue
  const benchmarkReturn =
    measured && benchmarkStart && benchmarkStart > 0 && benchmarkEnd
      ? benchmarkEnd / benchmarkStart - 1
      : null

  return {
    measured,
    benchmarkSymbol,
    startDate: snapshots[0].date,
    endDate,
    currentValue,
    netContributions,
    gain,
    totalReturn,
    benchmarkReturn,
    excessReturn: benchmarkReturn == null ? null : totalReturn - benchmarkReturn,
    maxDrawdown,
    observations: snapshots.length,
    source: sourceLabel(snapshots),
    points,
  }
}
