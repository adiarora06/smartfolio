// Derived portfolio analysis.
//
// Recomputes the deterministic diagnosis whenever holdings or profile change.
// Analysis is intentionally NOT stored in the Zustand store — it is a pure
// function of the inputs, so we derive it here.

import { useMemo } from 'react'
import { analyzePortfolio } from '../lib/calculations/portfolio'
import type { PortfolioAnalysis } from '../lib/calculations/portfolio'
import { useStore } from '../store/useStore'

export function usePortfolioAnalysis(): PortfolioAnalysis {
  const holdings = useStore((s) => s.holdings)
  const profile = useStore((s) => s.profile)
  return useMemo(() => analyzePortfolio(holdings, profile), [holdings, profile])
}
