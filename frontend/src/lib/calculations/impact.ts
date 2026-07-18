// Deterministic portfolio-impact analysis — local mirror of
// backend/app/services/impact.py, so offline mode keeps parity.

import { TARGETS } from '../data/constants'
import { portfolioValue, riskProfile } from './portfolio'
import type { Holding, InvestorProfile, PortfolioImpact, StockForecast } from '../../types'

const EQUITY_ASSETS = ['us_equity', 'intl_equity']
const SINGLE_STOCK_FLAG = 0.2
const SECTOR_FLAG = 0.35

export function computeImpact(
  forecast: Pick<StockForecast, 'symbol' | 'sector' | 'price'>,
  holdings: Holding[],
  profile: InvestorProfile,
): PortfolioImpact | null {
  if (!holdings.length) return null
  const total = portfolioValue(holdings)
  if (total <= 0) return null

  const added = Math.round(forecast.price * 10)
  const totalAfter = total + added

  const held = holdings
    .filter((h) => h.symbol.trim().toUpperCase() === forecast.symbol)
    .reduce((s, h) => s + Number(h.value), 0)
  const newWeight = (held + added) / totalAfter

  const sectorValue = holdings
    .filter((h) => h.sector === forecast.sector && EQUITY_ASSETS.includes(h.asset))
    .reduce((s, h) => s + Number(h.value), 0)
  const sectorWeightAfter = (sectorValue + added) / totalAfter

  const [name] = riskProfile(profile)
  const target = TARGETS[name]
  const current: Record<string, number> = {}
  holdings.forEach((h) => {
    current[h.asset] = (current[h.asset] || 0) + Number(h.value) / total
  })
  const after: Record<string, number> = {}
  Object.entries(current).forEach(([k, w]) => {
    after[k] = (w * total) / totalAfter
  })
  after.us_equity = (after.us_equity || 0) + added / totalAfter

  const gapDelta: Record<string, number> = {}
  ;[...new Set([...Object.keys(current), ...Object.keys(target), 'us_equity'])]
    .sort()
    .forEach((k) => {
      const gapBefore = (target[k] || 0) - (current[k] || 0)
      const gapAfter = (target[k] || 0) - (after[k] || 0)
      gapDelta[k] = gapAfter - gapBefore
    })

  return {
    addedValue: added,
    newWeight,
    sector: forecast.sector,
    sectorWeightAfter,
    triggersSingleStockFlag: newWeight > SINGLE_STOCK_FLAG,
    triggersSectorFlag: sectorWeightAfter > SECTOR_FLAG,
    gapDelta,
  }
}
