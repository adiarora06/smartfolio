import type { Holding, HoldingSource } from '../types'

export type NormalizedHolding = Holding & Required<Pick<Holding, 'id' | 'source'>>

export type HoldingTrackingStatus =
  | 'value_only'
  | 'basis_only'
  | 'priced'
  | 'complete'

export interface HoldingCoverageSummary {
  total: number
  totalValue: number
  withQuantity: number
  withCurrentPrice: number
  withCostBasis: number
  fullyTracked: number
  quantityCoverage: number
  pricedCoverage: number
  costBasisCoverage: number
  fullyTrackedCoverage: number
}

const HOLDING_SOURCES = new Set<HoldingSource>([
  'manual',
  'demo',
  'imported',
  'plaid',
  'analysis',
])

let fallbackIdCounter = 0

/** Create a client-safe opaque identity without deriving identity from a
 * mutable symbol, value, or row position. */
export function createHoldingId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.()
  if (randomUuid) return `holding-${randomUuid}`
  fallbackIdCounter += 1
  return `holding-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`
}

const nullableNumber = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12
    ? value
    : null
const nullablePositiveNumber = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e12
    ? value
    : null

const validCalendarDate = (value: string | null | undefined): string | null => {
  const match = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(`${value}T00:00:00Z`)
  return year > 0
    && !Number.isNaN(parsed.getTime())
    && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day
    ? value!.trim()
    : null
}

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100
const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

/** Upgrade one legacy/additive wire holding into the fully identified shape
 * used by app state. Reported `value` is deliberately preserved. */
export function normalizeHolding(
  holding: Holding,
  fallbackSource: HoldingSource = 'manual',
): NormalizedHolding {
  const quantity = nullableNumber(holding.quantity)
  let averageCost = nullableNumber(holding.averageCost)
  let costBasis = nullableNumber(holding.costBasis)
  const currentPrice = nullablePositiveNumber(holding.currentPrice)
  const existingId = holding.id?.trim()

  if (averageCost != null && !(quantity != null && quantity > 0)) {
    averageCost = null
  } else if (averageCost == null && costBasis != null && quantity != null && quantity > 0) {
    averageCost = costBasis / quantity
  } else if (costBasis == null && averageCost != null && quantity != null) {
    costBasis = roundMoney(quantity * averageCost)
  } else if (
    averageCost != null
    && costBasis != null
    && quantity != null
    && Math.abs(costBasis - quantity * averageCost) > Math.max(0.02, Math.abs(quantity * averageCost) * 1e-6)
  ) {
    // Total basis is the aggregate source of truth when a legacy record
    // contains two inconsistent basis representations.
    averageCost = costBasis / quantity
  }

  return {
    ...holding,
    id: existingId && existingId.length <= 64 ? existingId : createHoldingId(),
    symbol: holding.symbol.trim().toUpperCase(),
    source: holding.source && HOLDING_SOURCES.has(holding.source)
      ? holding.source
      : fallbackSource,
    quantity,
    averageCost,
    costBasis,
    currentPrice,
    priceAsOf: currentPrice == null ? null : validCalendarDate(holding.priceAsOf),
    priceSource: currentPrice == null
      ? null
      : (holding.priceSource?.trim() || 'manual').slice(0, 64),
    value: holding.value,
  }
}

/** Normalize an entire collection and repair accidental duplicate ids while
 * leaving every market value and the original order untouched. */
export function normalizeHoldings(
  holdings: Holding[],
  fallbackSource: HoldingSource = 'manual',
): NormalizedHolding[] {
  const seen = new Set<string>()
  return holdings.map((holding) => {
    let normalized = normalizeHolding(holding, fallbackSource)
    if (seen.has(normalized.id)) {
      normalized = { ...normalized, id: createHoldingId() }
    }
    seen.add(normalized.id)
    return normalized
  })
}

export function holdingAverageCost(holding: Holding): number | null {
  const explicit = nullableNumber(holding.averageCost)
  if (explicit != null) return explicit
  const quantity = nullableNumber(holding.quantity)
  const basis = nullableNumber(holding.costBasis)
  return quantity != null && quantity > 0 && basis != null ? basis / quantity : null
}

export function holdingGain(holding: Holding): number | null {
  if (holding.type === 'cash' || holding.asset === 'cash') return 0
  const basis = nullableNumber(holding.costBasis)
  return basis == null ? null : holding.value - basis
}

export function holdingGainPct(holding: Holding): number | null {
  if (holding.type === 'cash' || holding.asset === 'cash') return 0
  const basis = nullableNumber(holding.costBasis)
  const gain = holdingGain(holding)
  return basis != null && basis > 0 && gain != null ? gain / basis : null
}

export function holdingTrackingStatus(holding: Holding): HoldingTrackingStatus {
  if (holding.type === 'cash' || holding.asset === 'cash') return 'complete'
  const hasQuantity = nullableNumber(holding.quantity) != null
  const hasPrice = nullablePositiveNumber(holding.currentPrice) != null
  const hasBasis = nullableNumber(holding.costBasis) != null
  if (hasQuantity && hasPrice && hasBasis) return 'complete'
  if (hasQuantity && hasPrice) return 'priced'
  if (hasBasis) return 'basis_only'
  return 'value_only'
}

/** Coverage is value-weighted so a missing $10 position does not count the
 * same as a missing $100,000 position. Empty portfolios report zero. */
export function summarizeHoldingCoverage(holdings: Holding[]): HoldingCoverageSummary {
  const totalValue = holdings.reduce((sum, holding) => sum + Math.max(0, holding.value), 0)
  const pricedDenominator = holdings.reduce(
    (sum, holding) => holding.type === 'cash' || holding.asset === 'cash'
      ? sum
      : sum + Math.max(0, holding.value),
    0,
  )
  let withQuantity = 0
  let withCurrentPrice = 0
  let withCostBasis = 0
  let fullyTracked = 0
  let quantityValue = 0
  let pricedValue = 0
  let basisValue = 0
  let fullyTrackedValue = 0

  holdings.forEach((holding) => {
    const value = Math.max(0, holding.value)
    const isCash = holding.type === 'cash' || holding.asset === 'cash'
    const hasQuantity = nullableNumber(holding.quantity) != null
    const hasPrice = nullablePositiveNumber(holding.currentPrice) != null
    const hasBasis = nullableNumber(holding.costBasis) != null
    if (!isCash && hasQuantity) {
      withQuantity += 1
      quantityValue += value
    }
    if (!isCash && hasPrice) withCurrentPrice += 1
    if (!isCash && hasQuantity && hasPrice) {
      pricedValue += value
    }
    if (isCash || hasBasis) {
      withCostBasis += 1
      basisValue += value
    }
    if (isCash || (hasQuantity && hasPrice && hasBasis)) {
      fullyTracked += 1
      fullyTrackedValue += value
    }
  })

  const coverage = (value: number, denominator: number) =>
    denominator > 0 ? value / denominator : holdings.length > 0 ? 1 : 0
  return {
    total: holdings.length,
    totalValue,
    withQuantity,
    withCurrentPrice,
    withCostBasis,
    fullyTracked,
    quantityCoverage: coverage(quantityValue, pricedDenominator),
    pricedCoverage: coverage(pricedValue, pricedDenominator),
    costBasisCoverage: coverage(basisValue, totalValue),
    fullyTrackedCoverage: coverage(fullyTrackedValue, totalValue),
  }
}

/** Apply a user/import patch while keeping the two explicit arithmetic pairs
 * synchronized. Editing reported value alone never fabricates quantity or a
 * price; value therefore remains backward-compatible and authoritative. */
export function applyHoldingPatch(
  holding: NormalizedHolding,
  patch: Partial<Omit<Holding, 'id'>>,
): NormalizedHolding {
  const next: Holding = { ...holding, ...patch, id: holding.id }
  const quantity = nullableNumber(next.quantity)
  const currentPrice = nullablePositiveNumber(next.currentPrice)
  const averageCost = nullableNumber(next.averageCost)
  const costBasis = nullableNumber(next.costBasis)
  const changesQuantity = hasOwn(patch, 'quantity')
  const changesPrice = hasOwn(patch, 'currentPrice')
  const changesAverageCost = hasOwn(patch, 'averageCost')
  const changesCostBasis = hasOwn(patch, 'costBasis')

  if ((changesQuantity || changesPrice) && quantity != null && currentPrice != null) {
    next.value = roundMoney(quantity * currentPrice)
  }

  if ((changesQuantity || changesAverageCost) && quantity != null && averageCost != null) {
    next.costBasis = roundMoney(quantity * averageCost)
  } else if (changesCostBasis && !changesAverageCost && quantity != null && quantity > 0 && costBasis != null) {
    next.averageCost = costBasis / quantity
  }

  return normalizeHolding(next, holding.source)
}
