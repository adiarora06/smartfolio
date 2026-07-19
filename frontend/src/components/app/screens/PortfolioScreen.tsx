// Portfolio workspace — holdings you can edit, with the picture alongside:
// headline metrics, an allocation donut, and per-holding weight bars that all
// recalculate live as you type.

import { useStore } from '../../../store/useStore'
import { usePortfolioAnalysis } from '../../../hooks/usePortfolioAnalysis'
import { fmt, pct, title } from '../../../lib/format'
import { AppHero, MetricCard, MetricGrid, Panel, PanelHead } from '../../shared/ui'
import { DonutChart, type DonutSegment } from '../../shared/DonutChart'
import type { AssetClass, HoldingType } from '../../../types'

const ASSET_OPTIONS: Array<[AssetClass, string]> = [
  ['us_equity', 'US Equity'],
  ['intl_equity', 'Intl Equity'],
  ['bonds', 'bonds'],
  ['cash', 'cash'],
  ['alternatives', 'alternatives'],
]

const TYPE_OPTIONS: HoldingType[] = ['stock', 'etf', 'cash']

// Light-theme palette per asset class (donut + legend swatches).
const ASSET_COLORS: Record<string, string> = {
  us_equity: '#0f766e',
  intl_equity: '#1d4ed8',
  bonds: '#7c3aed',
  cash: '#64748b',
  alternatives: '#d97706',
  crypto: '#db2777',
  other: '#94a3b8',
}

/** Asset-class display name ("US Equity", not the title-cased "Us Equity"). */
const assetLabel = (k: string) =>
  k === 'us_equity' ? 'US Equity' : k === 'intl_equity' ? 'Intl Equity' : title(k)

export function PortfolioScreen() {
  const holdings = useStore((s) => s.holdings)
  const analysis = usePortfolioAnalysis()
  const addHolding = useStore((s) => s.addHolding)
  const resetHoldings = useStore((s) => s.resetHoldings)
  const removeHolding = useStore((s) => s.removeHolding)
  const updateHolding = useStore((s) => s.updateHolding)

  // Donut segments from the live asset-class allocation.
  const segments: DonutSegment[] = Object.entries(analysis.current)
    .filter(([, w]) => w > 0.004)
    .sort(([, a], [, b]) => b - a)
    .map(([asset, w]) => ({
      label: assetLabel(asset),
      pct: Math.round(w * 100),
      color: ASSET_COLORS[asset] ?? ASSET_COLORS.other,
    }))

  // Headline facts: biggest position, top sector, biggest allocation gap.
  const total = analysis.value || 1
  const largest = holdings.reduce(
    (best, h) => (h.value > best.value ? h : best),
    { symbol: '—', value: 0 } as { symbol: string; value: number },
  )
  const sectorTotals = new Map<string, number>()
  holdings.forEach((h) => {
    if (h.asset !== 'cash') {
      sectorTotals.set(h.sector, (sectorTotals.get(h.sector) ?? 0) + h.value)
    }
  })
  const topSector = [...sectorTotals.entries()].sort((a, b) => b[1] - a[1])[0]
  const biggestGap = Object.entries(analysis.gap).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
  )[0]

  // Per-holding weights, heaviest first.
  const weights = [...holdings]
    .filter((h) => h.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)

  return (
    <section className="screen active" id="portfolio">
      <AppHero
        title="Portfolio"
        subtitle="Edit holdings — everything recalculates instantly."
        actions={
          <>
            <button onClick={addHolding}>Add Holding</button>
            <button onClick={resetHoldings}>Reset Demo</button>
          </>
        }
      />

      <MetricGrid>
        <MetricCard
          label="Total Value"
          value={fmt.format(analysis.value)}
          sub={`${holdings.length} holdings`}
        />
        <MetricCard
          label="Largest Position"
          value={largest.symbol}
          sub={`${pct(largest.value / total)} of portfolio`}
        />
        <MetricCard
          label="Top Sector"
          value={topSector ? title(topSector[0]) : '—'}
          sub={topSector ? `${pct(topSector[1] / total)} of portfolio` : 'no holdings'}
        />
        <MetricCard
          label="Biggest Gap"
          value={biggestGap ? assetLabel(biggestGap[0]) : '—'}
          sub={
            biggestGap
              ? `${biggestGap[1] >= 0 ? 'need' : 'trim'} ${pct(Math.abs(biggestGap[1]))}`
              : 'on target'
          }
        />
      </MetricGrid>

      <Panel>
        <PanelHead title="Allocation" />
        <div className="body allocSplit">
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <DonutChart
              segments={segments}
              centerTitle={`$${(analysis.value / 1000).toFixed(analysis.value >= 100000 ? 0 : 1)}k`}
              centerSub={`${holdings.length} HOLDINGS`}
            />
            <ul className="donutLegend">
              {segments.map((s) => (
                <li key={s.label}>
                  <span className="swatch" style={{ background: s.color }} />
                  <span className="donutLabel">{s.label}</span>
                  <strong>{s.pct}%</strong>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="weightHead">Position weight</div>
            {weights.map((h) => (
              <div className="wrow" key={h.symbol}>
                <span className="sym">{h.symbol}</span>
                <div className="track">
                  <div
                    className="fill"
                    style={{ width: `${Math.min((h.value / total) * 100, 100)}%` }}
                  />
                </div>
                <span className="wpct">{pct(h.value / total)}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHead title="Holdings" />
        <div className="body">
            <div className="table">
              <div className="thead">
                <span>Symbol</span>
                <span>Name</span>
                <span>Type</span>
                <span>Asset</span>
                <span>Sector</span>
                <span>Value</span>
                <span />
              </div>
              {holdings.map((h, i) => (
                <div className="row" key={i}>
                  <input
                    name="symbol"
                    value={h.symbol}
                    onChange={(e) => updateHolding(i, 'symbol', e.target.value)}
                  />
                  <input
                    className="wide"
                    name="name"
                    value={h.name}
                    onChange={(e) => updateHolding(i, 'name', e.target.value)}
                  />
                  <select
                    name="type"
                    value={h.type}
                    onChange={(e) => updateHolding(i, 'type', e.target.value as HoldingType)}
                  >
                    {TYPE_OPTIONS.map((t) => (
                      <option value={t} key={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <select
                    name="asset"
                    value={h.asset}
                    onChange={(e) => updateHolding(i, 'asset', e.target.value as AssetClass)}
                  >
                    {ASSET_OPTIONS.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    name="sector"
                    value={h.sector}
                    onChange={(e) => updateHolding(i, 'sector', e.target.value)}
                  />
                  <input
                    name="value"
                    type="number"
                    value={h.value}
                    onChange={(e) => updateHolding(i, 'value', Number(e.target.value))}
                  />
                  <button onClick={() => removeHolding(i)}>Remove</button>
                </div>
              ))}
            </div>
          </div>
      </Panel>
    </section>
  )
}
