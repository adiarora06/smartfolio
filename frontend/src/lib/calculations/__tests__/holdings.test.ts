import { describe, expect, it } from 'vitest'
import type { Holding } from '../../../types'
import {
  applyHoldingPatch,
  holdingAverageCost,
  holdingGain,
  holdingGainPct,
  holdingTrackingStatus,
  normalizeHolding,
  normalizeHoldings,
  summarizeHoldingCoverage,
} from '../../holdings'

const legacyHolding = (patch: Partial<Holding> = {}): Holding => ({
  symbol: 'AAPL',
  name: 'Apple Inc.',
  type: 'stock',
  asset: 'us_equity',
  sector: 'technology',
  value: 5000,
  ...patch,
})

describe('holding normalization', () => {
  it('upgrades a legacy value-only holding without changing its reported value', () => {
    const normalized = normalizeHolding(legacyHolding({ symbol: ' aapl ' }))

    expect(normalized.id).toMatch(/^holding-/)
    expect(normalized.symbol).toBe('AAPL')
    expect(normalized.source).toBe('manual')
    expect(normalized.value).toBe(5000)
    expect(normalized.quantity).toBeNull()
    expect(normalized.currentPrice).toBeNull()
    expect(normalizeHolding(normalized).id).toBe(normalized.id)
  })

  it('repairs duplicate ids without changing order or values', () => {
    const normalized = normalizeHoldings([
      legacyHolding({ id: 'same', value: 10 }),
      legacyHolding({ id: 'same', value: 20 }),
    ])

    expect(normalized.map((holding) => holding.value)).toEqual([10, 20])
    expect(normalized[0].id).toBe('same')
    expect(normalized[1].id).not.toBe('same')
  })

  it('accepts only positive prices and real calendar dates', () => {
    const normalized = normalizeHolding(legacyHolding({
      currentPrice: 0,
      priceAsOf: '2026-02-30',
      priceSource: 'manual',
    }))

    expect(normalized.currentPrice).toBeNull()
    expect(normalized.priceAsOf).toBeNull()
    expect(normalized.priceSource).toBeNull()
  })
})

describe('holding calculations', () => {
  it('keeps quantity-price value and quantity-average-cost basis in sync on edits', () => {
    const holding = normalizeHolding(legacyHolding({
      quantity: 10,
      currentPrice: 500,
      averageCost: 400,
      costBasis: 4000,
    }))
    const repriced = applyHoldingPatch(holding, { currentPrice: 510 })
    const resized = applyHoldingPatch(repriced, { quantity: 12 })

    expect(repriced.value).toBe(5100)
    expect(resized.value).toBe(6120)
    expect(resized.costBasis).toBe(4800)
    expect(holdingAverageCost(resized)).toBe(400)
    expect(holdingGain(resized)).toBe(1320)
    expect(holdingGainPct(resized)).toBeCloseTo(0.275)
  })

  it('derives average cost when total basis is edited', () => {
    const holding = normalizeHolding(legacyHolding({ quantity: 20, currentPrice: 250 }))
    const updated = applyHoldingPatch(holding, { costBasis: 4000 })

    expect(updated.averageCost).toBe(200)
    expect(updated.costBasis).toBe(4000)
  })

  it('treats cash as complete with zero gain without demanding shares or a quote', () => {
    const cash = legacyHolding({
      symbol: 'CASH',
      name: 'Cash',
      type: 'cash',
      asset: 'cash',
      sector: 'cash',
      value: 500,
    })
    const equity = legacyHolding({ value: 500 })
    const coverage = summarizeHoldingCoverage([cash, equity])

    expect(holdingTrackingStatus(cash)).toBe('complete')
    expect(holdingGain(cash)).toBe(0)
    expect(holdingGainPct(cash)).toBe(0)
    expect(coverage.quantityCoverage).toBe(0)
    expect(coverage.pricedCoverage).toBe(0)
    expect(coverage.costBasisCoverage).toBe(0.5)
    expect(coverage.fullyTrackedCoverage).toBe(0.5)

    const allCash = summarizeHoldingCoverage([cash])
    expect(allCash.quantityCoverage).toBe(1)
    expect(allCash.pricedCoverage).toBe(1)
    expect(allCash.costBasisCoverage).toBe(1)
    expect(allCash.fullyTrackedCoverage).toBe(1)
  })
})
