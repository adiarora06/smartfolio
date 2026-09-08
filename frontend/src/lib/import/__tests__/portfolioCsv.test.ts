import { describe, expect, it } from 'vitest'
import { parsePortfolioCsv } from '../portfolioCsv'

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
