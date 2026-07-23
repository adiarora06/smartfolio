// Tests for the offline mirror of the distributional engine.
//
// The values asserted here are the ones backend/tests/test_quant.py asserts for
// the same inputs. When the two engines drift apart, offline mode starts
// drawing a different chart than the API does — a divergence that is invisible
// in normal use because the backend usually answers.

import { describe, expect, it } from 'vitest'
import {
  MARKET_DRIFT,
  normCdf,
  normPpf,
  probDrawdown,
  probGain,
  quantilePrice,
  quantileReturn,
  winsorize,
} from '../quant'
import {
  decompose,
  marginalContribution,
  maxWeightUnderVol,
  valueAtRisk,
  type Position,
} from '../risk'
import { analyzeStock } from '../stock'

describe('normal distribution helpers', () => {
  it('matches the backend z-scores exactly', () => {
    expect(normPpf(0.25)).toBeCloseTo(-0.6744897501960817, 12)
    expect(normPpf(0.75)).toBeCloseTo(0.6744897501960817, 12)
    expect(normPpf(0.95)).toBeCloseTo(1.6448536269514722, 12)
  })

  it('cdf and ppf invert each other', () => {
    for (const q of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      expect(normCdf(normPpf(q))).toBeCloseTo(q, 5)
    }
  })
})

describe('quantile cone', () => {
  it('orders quantiles strictly', () => {
    const prices = [0.05, 0.25, 0.5, 0.75, 0.95].map((q) => quantilePrice(100, 0.08, 0.3, 0.25, q))
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    expect(new Set(prices).size).toBe(prices.length)
  })

  it('widens with sqrt(t), not linearly', () => {
    const width = (t: number) =>
      Math.log(quantilePrice(100, 0.08, 0.3, t, 0.95) / quantilePrice(100, 0.08, 0.3, t, 0.05))
    // Quadrupling the horizon must exactly double the log width.
    expect(width(1.0) / width(0.25)).toBeCloseTo(2.0, 6)
  })

  it('agrees with the backend to full double precision', () => {
    // Values produced by backend/app/services/quant.py for s0=100, mu=0.08,
    // sigma=0.30, t=0.25. Asserted to 10 decimals: the two engines share the
    // same closed form and the same hardcoded z-table, so anything less exact
    // would mean one of them has genuinely diverged.
    expect(quantilePrice(100, 0.08, 0.3, 0.25, 0.05)).toBeCloseTo(78.82199970283669, 10)
    expect(quantilePrice(100, 0.08, 0.3, 0.25, 0.25)).toBeCloseTo(91.17189889594138, 10)
    expect(quantilePrice(100, 0.08, 0.3, 0.25, 0.5)).toBeCloseTo(100.87883931483161, 10)
    expect(quantilePrice(100, 0.08, 0.3, 0.25, 0.75)).toBeCloseTo(111.61926366283721, 10)
    expect(quantilePrice(100, 0.08, 0.3, 0.25, 0.95)).toBeCloseTo(129.10786658386922, 10)
  })

  it('ties probGain to the sign of the median return', () => {
    for (const [mu, sigma] of [
      [0.2, 0.2],
      [0.02, 0.4],
      [-0.1, 0.25],
    ]) {
      const median = quantileReturn(mu, sigma, 0.5, 0.5)
      expect(probGain(mu, sigma, 0.5) > 0.5).toBe(median > 0)
    }
  })

  it('makes deeper drawdowns less likely', () => {
    expect(probDrawdown(0.07, 0.3, 0.5, 0.1)).toBeGreaterThan(probDrawdown(0.07, 0.3, 0.5, 0.2))
  })
})

describe('winsorize', () => {
  it('clips a lone crash bar without dropping or reordering it', () => {
    const returns = Array.from({ length: 40 }, (_, i) => [0.01, -0.02, 0.005, 0.012][i % 4])
    returns[25] = -0.3
    const clipped = winsorize(returns)

    expect(clipped).toHaveLength(returns.length)
    expect(clipped[25]).toBe(Math.min(...clipped))
    expect(clipped[25]).toBeGreaterThan(-0.3)
    expect(clipped[25]).toBeLessThan(0)
    expect(clipped[0]).toBeCloseTo(0.01, 10)
  })

  it('leaves a genuinely volatile series alone', () => {
    const volatile = Array.from(
      { length: 48 },
      (_, i) => [0.08, -0.09, 0.07, -0.08, 0.09, -0.07][i % 6],
    )
    expect(winsorize(volatile)).toEqual(volatile)
  })
})

describe('risk model', () => {
  const positions = (): Position[] => [
    { label: 'AAPL', weight: 0.3, beta: 1.2, vol: 0.28 },
    { label: 'VTI', weight: 0.45, beta: 1.0, vol: 0.16 },
    { label: 'BND', weight: 0.2, beta: 0.15, vol: 0.06 },
    { label: 'CASH', weight: 0.05, beta: 0.0, vol: 0.002 },
  ]

  it('sums risk contributions to portfolio volatility', () => {
    const p = positions()
    const total = p.reduce((s, pos, i) => s + pos.weight * marginalContribution(p, i), 0)
    expect(total).toBeCloseTo(decompose(p).volatility, 10)
  })

  it('rewards diversification', () => {
    const concentrated: Position[] = [{ label: 'ONE', weight: 1, beta: 1.1, vol: 0.3 }]
    const spread: Position[] = Array.from({ length: 10 }, (_, i) => ({
      label: `S${i}`,
      weight: 0.1,
      beta: 1.1,
      vol: 0.3,
    }))
    expect(decompose(spread).volatility).toBeLessThan(decompose(concentrated).volatility)
  })

  it('scales VaR with sqrt(time)', () => {
    expect(valueAtRisk(0.2, 1.0) / valueAtRisk(0.2, 0.25)).toBeCloseTo(2.0, 6)
  })

  it('keeps the max position within the volatility ceiling', () => {
    const base = positions()
    const candidate: Position = { label: 'RISKY', weight: 0, beta: 1.5, vol: 0.6 }
    const w = maxWeightUnderVol(base, candidate, 0.18)
    const blended = base.map((p) => ({ ...p, weight: p.weight * (1 - w) }))
    blended.push({ ...candidate, weight: w })
    expect(decompose(blended).volatility).toBeLessThanOrEqual(0.18 + 1e-6)
  })
})

describe('offline engine', () => {
  it('is deterministic', () => {
    expect(analyzeStock('NVDA', 45)).toEqual(analyzeStock('NVDA', 45))
  })

  it('opens the cone from a single point at spot', () => {
    const f = analyzeStock('AAPL', 90)
    const first = f.paths[0]
    expect(first.q05).toBeCloseTo(f.price, 6)
    expect(first.q95).toBeCloseTo(f.price, 6)
  })

  it('keeps targets internally consistent', () => {
    const f = analyzeStock('AAPL', 90)
    expect(f.bearTarget).toBeLessThan(f.q25Target)
    expect(f.q25Target).toBeLessThan(f.medianTarget)
    expect(f.medianTarget).toBeLessThan(f.q75Target)
    expect(f.q75Target).toBeLessThan(f.bullTarget)
    expect(f.medianTarget).toBeCloseTo(f.price * (1 + f.expected), 6)
    // Mean of a lognormal sits above its median for any sigma > 0.
    expect(f.expectedMean).toBeGreaterThan(f.expected)
  })

  it('marks everything unmeasured — the browser has no history', () => {
    const f = analyzeStock('AAPL', 90)
    expect(f.backtest.measured).toBe(false)
    expect(f.inputs?.volMeasured).toBe(false)
    expect(f.inputs?.dataCompleteness).toBe(0)
  })

  it('collapses drift toward the market prior with no signals', () => {
    const f = analyzeStock('AAPL', 90)
    // Offline shrinkage is 0.15, so mu must sit very close to the prior.
    expect(Math.abs((f.inputs?.mu ?? 0) - MARKET_DRIFT)).toBeLessThan(0.03)
  })
})
