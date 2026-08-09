import type { PortfolioTransaction, ValuationSnapshot } from '../../types'

export interface PerformancePoint {
  date: string
  value: number
  cumulativeContributions: number
  portfolioIndex: number
  benchmarkIndex: number | null
}

export interface PerformanceSummary {
  measured: boolean
  benchmarkSymbol: string
  startDate: string | null
  endDate: string | null
  currentValue: number
  netContributions: number
  gain: number
  totalReturn: number
  benchmarkReturn: number | null
  excessReturn: number | null
  maxDrawdown: number
  observations: number
  source: 'demo' | 'imported' | 'manual' | 'mixed'
  points: PerformancePoint[]
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

/** Cash-flow-adjusted time-weighted performance from explicit dated valuations.
 * A return is only measured when at least two valuation dates exist. */
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
