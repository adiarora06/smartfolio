// Tests for the deterministic client-side engine — the numbers users see.

import { describe, expect, it } from 'vitest'
import { analyzePortfolio } from '../portfolio'
import { projectScenario } from '../scenario'
import { computeImpact } from '../impact'
import { analyzeStock } from '../stock'
import { DEFAULT_PROFILE, demoHoldings } from '../../data/constants'

const holdings = demoHoldings()
const analysis = analyzePortfolio(holdings, DEFAULT_PROFILE)

describe('analyzePortfolio', () => {
  it('sums the demo portfolio to $25,000', () => {
    expect(analysis.value).toBe(25000)
  })

  it('allocation weights sum to ~1', () => {
    const total = Object.values(analysis.current).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 6)
  })

  it('flags the demo portfolio concentrations', () => {
    const kinds = analysis.concentrations.map((c) => c.kind)
    expect(kinds).toContain('single_stock') // NVDA is 22%
    expect(kinds).toContain('sector') // technology-heavy
  })

  it('produces gap = target - current per asset class', () => {
    Object.keys(analysis.gap).forEach((k) => {
      expect(analysis.gap[k]).toBeCloseTo(
        (analysis.target[k] || 0) - (analysis.current[k] || 0),
        10,
      )
    })
  })
})

describe('projectScenario', () => {
  const inputs = { contribution: 500, returnAdj: 0, rebalance: 0.5 }
  const projection = projectScenario(analysis, inputs)

  it('grows over time', () => {
    const [p1, p5, p10] = projection.points.map((p) => p.value)
    expect(p5).toBeGreaterThan(p1)
    expect(p10).toBeGreaterThan(p5)
  })

  it('series starts at the portfolio value and has 11 yearly points', () => {
    expect(projection.series).toHaveLength(11)
    expect(projection.series[0]).toBe(analysis.value)
  })

  it('contributions strictly beat growth-only', () => {
    expect(projection.series[10]).toBeGreaterThan(projection.growthOnlySeries[10])
  })

  it('points agree with the series', () => {
    projection.points.forEach(({ years, value }) => {
      expect(value).toBeCloseTo(projection.series[years], 6)
    })
  })
})

describe('computeImpact', () => {
  it('what-if weight includes shares already held', () => {
    const stock = analyzeStock('AAPL', 30)
    const impact = computeImpact(stock, holdings, DEFAULT_PROFILE)
    expect(impact).not.toBeNull()
    if (impact) {
      const alreadyHeld = holdings
        .filter((h) => h.symbol === 'AAPL')
        .reduce((s, h) => s + h.value, 0)
      const expected =
        (alreadyHeld + impact.addedValue) / (analysis.value + impact.addedValue)
      expect(impact.newWeight).toBeCloseTo(expected, 6)
      // AAPL already at 20% -> adding more must trip the 20% single-stock flag.
      expect(impact.triggersSingleStockFlag).toBe(true)
    }
  })
})

describe('analyzeStock', () => {
  it('bear <= median <= bull targets', () => {
    const s = analyzeStock('MSFT', 60)
    expect(s.bearTarget).toBeLessThanOrEqual(s.medianTarget)
    expect(s.medianTarget).toBeLessThanOrEqual(s.bullTarget)
  })

  it('is deterministic for the same inputs', () => {
    const a = analyzeStock('NVDA', 30)
    const b = analyzeStock('NVDA', 30)
    expect(a.medianTarget).toBe(b.medianTarget)
    expect(a.confidence).toBe(b.confidence)
  })
})
