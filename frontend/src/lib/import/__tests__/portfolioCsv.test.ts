import { describe, expect, it } from 'vitest'
import { parsePortfolioCsv, PORTFOLIO_CSV_TEMPLATE } from '../portfolioCsv'

describe('portfolio CSV holdings', () => {
  it('keeps legacy value-only holding files compatible', () => {
    const parsed = parsePortfolioCsv(
      'record_type,symbol,name,holding_type,asset,sector,amount\nholding,AAPL,Apple Inc.,stock,us_equity,technology,5000',
    )

    expect(parsed.errors).toEqual([])
    expect(parsed.holdings[0]).toMatchObject({
      symbol: 'AAPL',
      value: 5000,
      source: 'imported',
      quantity: null,
      currentPrice: null,
    })
    expect(parsed.holdings[0].id).toBeTruthy()
  })

  it('imports enriched positions and links activity by stable holding id', () => {
    const parsed = parsePortfolioCsv(
      [
        'record_type,holding_id,date,transaction_type,symbol,quantity,price,amount,current_price,average_cost,cost_basis,market_value,price_as_of,price_source',
        'holding,position-a,,,AAPL,20,,,250,190,3800,5000,2026-08-08,broker',
        'transaction,position-a,2026-01-03,buy,AAPL,20,190,3800,,,,,,',
      ].join('\n'),
    )

    expect(parsed.errors).toEqual([])
    expect(parsed.holdings[0]).toMatchObject({
      id: 'position-a',
      quantity: 20,
      currentPrice: 250,
      averageCost: 190,
      costBasis: 3800,
      value: 5000,
      priceAsOf: '2026-08-08',
      priceSource: 'broker',
    })
    expect(parsed.transactions[0].holdingId).toBe('position-a')
  })

  it('can derive a missing market value from quantity and current price', () => {
    const parsed = parsePortfolioCsv(
      'record_type,symbol,quantity,current_price\nholding,VTI,4,250',
    )

    expect(parsed.errors).toEqual([])
    expect(parsed.holdings[0].value).toBe(1000)
  })

  it('keeps the downloadable enriched template valid', () => {
    const parsed = parsePortfolioCsv(PORTFOLIO_CSV_TEMPLATE)

    expect(parsed.errors).toEqual([])
    expect(parsed.holdings).toHaveLength(1)
    expect(parsed.transactions).toHaveLength(1)
    expect(parsed.valuations).toHaveLength(2)
  })

  it('rejects an impossible price as-of date', () => {
    const parsed = parsePortfolioCsv(
      'record_type,symbol,market_value,current_price,price_as_of\nholding,AAPL,5000,250,2026-02-30',
    )

    expect(parsed.holdings).toEqual([])
    expect(parsed.errors).toEqual([
      'Line 2: price_as_of must be a valid YYYY-MM-DD date.',
    ])
  })

  it('rejects average cost without quantity and inconsistent total basis', () => {
    const missingQuantity = parsePortfolioCsv(
      'record_type,symbol,market_value,average_cost\nholding,AAPL,5000,190',
    )
    const inconsistent = parsePortfolioCsv(
      'record_type,symbol,market_value,quantity,average_cost,cost_basis\nholding,AAPL,5000,20,190,3900',
    )

    expect(missingQuantity.errors).toEqual([
      'Line 2: average_cost requires a positive quantity.',
    ])
    expect(inconsistent.errors).toEqual([
      'Line 2: cost_basis must equal quantity multiplied by average_cost.',
    ])
  })
})

describe('portfolio CSV date validation', () => {
  it.each([
    '2025-02-29',
    '2026-02-30',
    '2026-04-31',
    '2026-13-01',
    '0000-01-01',
  ])('rejects the invalid calendar date %s', (date) => {
    const parsed = parsePortfolioCsv(
      `record_type,date,portfolio_value\nsnapshot,${date},100`,
    )

    expect(parsed.valuations).toEqual([])
    expect(parsed.errors).toEqual([
      'Line 2: a snapshot needs YYYY-MM-DD date and portfolio_value.',
    ])
  })

  it('accepts a valid leap-day snapshot', () => {
    const parsed = parsePortfolioCsv(
      'record_type,date,portfolio_value\nsnapshot,2024-02-29,100',
    )

    expect(parsed.errors).toEqual([])
    expect(parsed.valuations).toHaveLength(1)
    expect(parsed.valuations[0].date).toBe('2024-02-29')
  })

  it('applies strict calendar validation to activity rows too', () => {
    const parsed = parsePortfolioCsv(
      'record_type,date,transaction_type,amount\ntransaction,2026-09-31,deposit,50',
    )

    expect(parsed.transactions).toEqual([])
    expect(parsed.errors).toEqual([
      'Line 2: activity needs YYYY-MM-DD date, a supported type, and amount.',
    ])
  })
})
