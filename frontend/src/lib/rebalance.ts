import type { Holding } from '../types'
import type { RebalanceMode, RebalancePreview } from './api/client'

const holdingKey = (holding: Holding) => `${holding.symbol.trim().toUpperCase()}::${holding.asset}`

/** A preview is applicable only when the backend returned a complete, exact
 * holdings snapshot. Asset-level "choose investment" rows stay preview-only. */
export function rebalanceApplyBlocker(
  current: Holding[],
  preview: RebalancePreview,
): string | null {
  if (!preview.canApply || preview.trades.some((trade) => !trade.resolved || !trade.symbol)) {
    return 'Choose an investment for every unresolved asset before applying this plan.'
  }

  const projected = preview.projectedHoldings
  if (!projected?.length) {
    return 'The engine did not return an exact projected portfolio. Refresh the preview.'
  }
  if (projected.length !== current.length) {
    return 'This preview changes the holding list and needs a security-selection step first.'
  }

  if (
    projected.some(
      (holding, index) =>
        holdingKey(holding) !== holdingKey(current[index]) ||
        !Number.isFinite(holding.value) ||
        holding.value < 0,
    )
  ) {
    return 'The projected portfolio no longer matches the current holdings. Refresh the preview.'
  }

  return null
}

export function exactProjectedHoldings(
  current: Holding[],
  preview: RebalancePreview,
): Holding[] {
  const blocker = rebalanceApplyBlocker(current, preview)
  if (blocker) throw new Error(blocker)
  return preview.projectedHoldings!.map((holding) => ({ ...holding }))
}

export function rebalanceInputSignature(
  holdings: Holding[],
  mode: RebalanceMode,
  contributionAmount: number,
  minTradeAmount: number,
): string {
  return JSON.stringify({
    holdings: holdings.map((holding) => ({
      symbol: holding.symbol.trim().toUpperCase(),
      asset: holding.asset,
      value: Number(holding.value),
    })),
    mode,
    contributionAmount: Number(contributionAmount),
    minTradeAmount: Number(minTradeAmount),
  })
}

/** Half the absolute allocation distance is the fraction of capital that
 * would need to move to reach the target exactly. */
export function allocationDrift(
  allocation: Record<string, number>,
  target: Record<string, number>,
): number {
  const assets = new Set([...Object.keys(allocation), ...Object.keys(target)])
  let distance = 0
  assets.forEach((asset) => {
    distance += Math.abs((allocation[asset] ?? 0) - (target[asset] ?? 0))
  })
  return distance / 2
}
