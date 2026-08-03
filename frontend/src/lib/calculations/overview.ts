import type { AllocationMap } from '../../types'

export interface FolioPathPoint {
  progress: number
  portfolio: number
  target: number
  low: number
  high: number
}

export interface AllocationMove {
  asset: string
  delta: number
}

/** Score how closely the current allocation matches its deterministic target. */
export function calculateFolioFit(gap: AllocationMap, concentrationCount: number): number {
  const allocationDistance = Object.values(gap).reduce((sum, value) => sum + Math.abs(value), 0) / 2
  const penalty = allocationDistance * 70 + Math.min(concentrationCount, 5) * 2
  return Math.round(Math.max(35, Math.min(100, 100 - penalty)))
}

/** Select the largest underweight asset class as the clearest next allocation move. */
export function selectSmartMove(gap: AllocationMap): AllocationMove | null {
  // A material bond gap gets priority because it improves balance without
  // changing the investor's declared growth posture.
  if ((gap.bonds || 0) >= 0.08) return { asset: 'bonds', delta: gap.bonds }

  const candidates = Object.entries(gap)
    .filter(([, delta]) => delta > 0.02)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

  return candidates.length ? { asset: candidates[0][0], delta: candidates[0][1] } : null
}

/**
 * Build a deterministic modeled path and risk-fit corridor. This is a planning
 * visualization, not historical price data or a claim about future returns.
 */
export function buildFolioPath(
  currentReturn: number,
  targetReturn: number,
  years: number,
): FolioPathPoint[] {
  const steps = 20
  const portfolioGain = Math.pow(1 + currentReturn, years) - 1
  const targetGain = Math.pow(1 + targetReturn, years) - 1
  const band = Math.min(0.2, 0.035 * Math.sqrt(years))
  const texture = [0, 0.18, -0.08, 0.28, 0.1, 0.38, 0.2, 0.44, 0.22, 0.5, 0.34, 0.6, 0.42, 0.68, 0.5, 0.76, 0.61, 0.84, 0.72, 0.9, 1]

  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps
    const modeledTexture = (texture[index] - progress) * Math.min(0.04, 0.018 * Math.sqrt(years))
    const target = 1 + targetGain * progress
    const spread = band * Math.sqrt(progress)
    return {
      progress,
      portfolio: 1 + portfolioGain * progress + modeledTexture,
      target,
      low: target - spread,
      high: target + spread,
    }
  })
}
