// Portfolio workspace — editable holdings table that recalculates live.

import { useStore } from '../../../store/useStore'
import { usePortfolioAnalysis } from '../../../hooks/usePortfolioAnalysis'
import { fmt } from '../../../lib/format'
import { AppHero, Panel, PanelHead } from '../../shared/ui'
import type { AssetClass, HoldingType } from '../../../types'

const ASSET_OPTIONS: Array<[AssetClass, string]> = [
  ['us_equity', 'US Equity'],
  ['intl_equity', 'Intl Equity'],
  ['bonds', 'bonds'],
  ['cash', 'cash'],
  ['alternatives', 'alternatives'],
]

const TYPE_OPTIONS: HoldingType[] = ['stock', 'etf', 'cash']

export function PortfolioScreen() {
  const holdings = useStore((s) => s.holdings)
  const analysis = usePortfolioAnalysis()
  const addHolding = useStore((s) => s.addHolding)
  const resetHoldings = useStore((s) => s.resetHoldings)
  const removeHolding = useStore((s) => s.removeHolding)
  const updateHolding = useStore((s) => s.updateHolding)

  return (
    <section className="screen active" id="portfolio">
      <AppHero
        title="Portfolio workspace"
        subtitle="Edit holdings and watch SmartFolio update instantly."
        actions={
          <>
            <button onClick={addHolding}>Add Holding</button>
            <button onClick={resetHoldings}>Reset Demo</button>
          </>
        }
      />
      <Panel>
        <PanelHead title="Holdings" subtitle={`Total value ${fmt.format(analysis.value)}`} />
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
