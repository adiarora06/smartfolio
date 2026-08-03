import { describe, expect, it } from 'vitest'
import { buildFolioPath, calculateFolioFit, selectSmartMove } from '../overview'

describe('overview calculations', () => {
  it('scores a target allocation at 100 and penalizes distance and concentration', () => {
    expect(calculateFolioFit({ us_equity: 0, bonds: 0 }, 0)).toBe(100)
    expect(calculateFolioFit({ us_equity: -0.2, bonds: 0.2 }, 2)).toBe(82)
  })

  it('selects the largest positive allocation gap', () => {
    expect(selectSmartMove({ bonds: 0.1, intl_equity: 0.14, cash: -0.03 })).toEqual({
      asset: 'bonds',
      delta: 0.1,
    })
    expect(selectSmartMove({ bonds: 0.04, intl_equity: 0.14, cash: -0.03 })).toEqual({
      asset: 'intl_equity',
      delta: 0.14,
    })
    expect(selectSmartMove({ bonds: 0.01, cash: -0.01 })).toBeNull()
  })

  it('anchors the modeled path at one and ends at the compounded current return', () => {
    const path = buildFolioPath(0.1, 0.08, 1)
    expect(path).toHaveLength(21)
    expect(path[0]).toEqual({ progress: 0, portfolio: 1, target: 1, low: 1, high: 1 })
    expect(path[path.length - 1].portfolio).toBeCloseTo(1.1)
    expect(path[path.length - 1].target).toBeCloseTo(1.08)
  })
})
