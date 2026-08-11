import { describe, expect, it } from 'vitest'
import { TARGETS } from '../constants'

describe('target allocations', () => {
  it.each(Object.entries(TARGETS))('%s sums to 100%', (_profile, allocation) => {
    const total = Object.values(allocation).reduce((sum, weight) => sum + (weight ?? 0), 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('keeps the balanced profile normalized', () => {
    expect(TARGETS.balanced).toEqual({
      us_equity: 0.45,
      intl_equity: 0.2,
      bonds: 0.25,
      cash: 0.05,
      alternatives: 0.05,
    })
  })
})
