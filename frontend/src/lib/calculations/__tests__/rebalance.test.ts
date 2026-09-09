import { describe, expect, it } from 'vitest'
import type { Holding } from '../../../types'
import type { RebalancePreview } from '../../api/client'
import {
  allocationDrift,
  exactProjectedHoldings,
  rebalanceApplyBlocker,
  rebalanceInputSignature,
} from '../../rebalance'

const holdings: Holding[] = [
  {
    symbol: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    type: 'etf',
    asset: 'us_equity',
    sector: 'broad_market',
    value: 8000,
  },
  {
    symbol: 'VXUS',
    name: 'Vanguard Total International Stock ETF',
    type: 'etf',
    asset: 'intl_equity',
    sector: 'broad_market',
    value: 2000,
  },
]

const preview = (patch: Partial<RebalancePreview> = {}): RebalancePreview => ({
  mode: 'new_money_only',
  beforeTotal: 10000,
  afterTotal: 11000,
  totalTraded: 1000,
  estimatedTrades: 1,
  beforeAllocation: { us_equity: 0.8, intl_equity: 0.2 },
  afterAllocation: { us_equity: 0.7273, intl_equity: 0.2727 },
  targetAllocation: { us_equity: 0.6, intl_equity: 0.4 },
  targetSource: 'risk_profile',
  targetProfile: 'growth',
  projectedHoldings: [holdings[0], { ...holdings[1], value: 3000 }],
  trades: [
    {
      symbol: 'VXUS',
      name: holdings[1].name,
      asset: 'intl_equity',
      action: 'buy',
      amount: 1000,
      beforeValue: 2000,
      afterValue: 3000,
      resolved: true,
    },
  ],
  warnings: [],
  canApply: true,
  totalBuys: 1000,
  totalSells: 0,
  cashRemaining: 0,
  unresolvedAmount: 0,
  exactTargetReached: false,
  previewOnly: true,
  ...patch,
})

describe('rebalance preview safeguards', () => {
  it('applies the exact projected holding values returned by the engine', () => {
    const next = exactProjectedHoldings(holdings, preview())
    expect(next.map((holding) => holding.value)).toEqual([8000, 3000])
    expect(next).not.toBe(preview().projectedHoldings)
  })

  it('blocks unresolved asset-level recommendations', () => {
    const unresolved = preview({
      canApply: false,
      trades: [
        {
          symbol: null,
          name: null,
          asset: 'bonds',
          action: 'buy',
          amount: 1000,
          resolved: false,
        },
      ],
    })
    expect(rebalanceApplyBlocker(holdings, unresolved)).toMatch(/Choose an investment/)
  })

  it('explains why priced holdings need executed share quantities before apply', () => {
    const quantityGuard = preview({
      canApply: false,
      warnings: [
        {
          code: 'share_quantity_unadjusted',
          message: 'Share quantities are not changed by a dollar preview.',
        },
      ],
    })

    expect(rebalanceApplyBlocker(holdings, quantityGuard)).toMatch(/executed share quantities/i)
    expect(rebalanceApplyBlocker(holdings, quantityGuard)).not.toMatch(/Choose an investment/)
  })

  it('blocks a projected snapshot that no longer matches the portfolio', () => {
    const mismatched = preview({
      projectedHoldings: [{ ...holdings[0], symbol: 'AAPL' }, holdings[1]],
    })
    expect(rebalanceApplyBlocker(holdings, mismatched)).toMatch(/no longer matches/)
  })

  it('changes the request signature when a model input changes', () => {
    const first = rebalanceInputSignature(holdings, 'new_money_only', 1000, 100)
    const second = rebalanceInputSignature(holdings, 'new_money_only', 1500, 100)
    expect(first).not.toBe(second)
  })

  it('computes half-distance allocation drift', () => {
    expect(
      allocationDrift(
        { us_equity: 0.8, intl_equity: 0.2 },
        { us_equity: 0.6, intl_equity: 0.4 },
      ),
    ).toBeCloseTo(0.2)
  })
})
