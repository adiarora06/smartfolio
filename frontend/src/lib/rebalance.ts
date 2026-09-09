import type { Holding } from '../types'
import type { RebalanceMode, RebalancePreview } from './api/client'

const holdingKey = (holding: Holding) => {
  const legacyIdentity = `${holding.symbol.trim().toUpperCase()}::${holding.asset}`
  return holding.id ? `id::${holding.id}::${legacyIdentity}` : `legacy::${legacyIdentity}`
}

/** A preview is applicable only when the backend returned a complete, exact
 * holdings snapshot. Asset-level "choose investment" rows stay preview-only. */
export function rebalanceApplyBlocker(
  current: Holding[],
  preview: RebalancePreview,
): string | null {
  if (preview.trades.some((trade) => !trade.resolved || !trade.symbol)) {
    return 'Choose an investment for every unresolved asset before applying this plan.'
  }
  if (preview.warnings.some((warning) => warning.code === 'share_quantity_unadjusted')) {
    return 'This dollar preview does not update executed share quantities. Record the completed trades before applying position changes.'
  }
  if (!preview.canApply) {
    return 'This preview is not ready to apply. Review its planning notes and refresh it.'
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
      id: holding.id ?? null,
      symbol: holding.symbol.trim().toUpperCase(),
      name: holding.name,
      type: holding.type,
      asset: holding.asset,
      sector: holding.sector,
      value: Number(holding.value),
      source: holding.source ?? null,
      quantity: holding.quantity ?? null,
      averageCost: holding.averageCost ?? null,
      costBasis: holding.costBasis ?? null,
      currentPrice: holding.currentPrice ?? null,
      priceAsOf: holding.priceAsOf ?? null,
      priceSource: holding.priceSource ?? null,
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
