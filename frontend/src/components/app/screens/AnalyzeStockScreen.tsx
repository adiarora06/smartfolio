// Analyze Stock — the OpenVC-style terminal.
// Forecast / Backtest / Topology / Audit / Memory tabs over a deterministic run.

import { useEffect, useState } from 'react'
import { useStore } from '../../../store/useStore'
import { fmt, pct, title } from '../../../lib/format'
import { buildForecastMemo } from '../../../lib/ai/memo'
import { AppHero, Panel, PanelHead } from '../../shared/ui'
import { ForecastChart } from '../../shared/ForecastChart'
import type { StockTab } from '../../../types'

const TABS: Array<[StockTab, string]> = [
  ['forecast', 'Forecast'],
  ['backtest', 'Backtest'],
  ['topology', 'Topology'],
  ['audit', 'Audit Log'],
  ['memory', 'Memory'],
]

export function AnalyzeStockScreen() {
  const stock = useStore((s) => s.stock)
  const stockSource = useStore((s) => s.stockSource)
  const stockTab = useStore((s) => s.stockTab)
  const stockMemory = useStore((s) => s.stockMemory)
  const setStockTab = useStore((s) => s.setStockTab)
  const setScreen = useStore((s) => s.setScreen)
  const runStock = useStore((s) => s.runStock)
  const resetStock = useStore((s) => s.resetStock)
  const addStockToPortfolio = useStore((s) => s.addStockToPortfolio)
  const saveMemo = useStore((s) => s.saveMemo)

  // Local input state; re-synced whenever a new analysis lands (run / reset).
  const [ticker, setTicker] = useState(stock.symbol)
  const [horizon, setHorizon] = useState(String(stock.days))
  useEffect(() => {
    setTicker(stock.symbol)
    setHorizon(String(stock.days))
  }, [stock.symbol, stock.days])

  return (
    <section className="screen active" id="stock">
      <AppHero
        title="Analyze Stock"
        subtitle="A separate OpenVC-style stock terminal: forecast, backtest, topology, audit log, memory, and portfolio handoff."
        actions={
          <>
            <button onClick={addStockToPortfolio}>Add To Portfolio</button>
            <button onClick={saveMemo}>Save Memo</button>
            <button className="primary" onClick={() => setScreen('advisor')}>
              Ask Advisor
            </button>
          </>
        }
      />

      <Panel>
        <PanelHead
          title="Stock Analysis Terminal"
          subtitle="Run a deterministic prototype analysis for any ticker."
        />
        <div className="body formgrid">
          <label>
            Ticker
            <input value={ticker} onChange={(e) => setTicker(e.target.value)} />
          </label>
          <label>
            Horizon days
            <input
              type="number"
              min={7}
              max={365}
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
            />
          </label>
          <button className="primary" onClick={() => runStock(ticker, Number(horizon))}>
            Run Analysis
          </button>
          <button onClick={resetStock}>Reset AAPL</button>
        </div>
      </Panel>

      <section className="terminal">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2>{stock.symbol} Forecast</h2>
            <span style={{ color: '#93c5fd' }}>
              {stock.name} · {title(stock.sector)}
            </span>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {stock.source && stock.source !== 'offline' ? (
                <span style={{ color: '#5eead4' }}>
                  ● Live price · {stock.source}
                  {stock.asOf ? ` · ${stock.asOf}` : ''}
                </span>
              ) : (
                <span style={{ color: '#93c5fd', opacity: 0.7 }}>
                  ○ Offline reference price (demo)
                </span>
              )}
            </div>
          </div>
          <span>
            {stock.rating} · {stockSource === 'api' ? 'API' : 'Local'}
          </span>
        </div>

        <div className="tabs">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              className={stockTab === id ? 'active' : undefined}
              onClick={() => setStockTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="pane active">
          {stockTab === 'forecast' && <ForecastPane />}
          {stockTab === 'backtest' && <BacktestPane />}
          {stockTab === 'topology' && (
            <ul className="list termList">
              {stock.trace.topology.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          {stockTab === 'audit' && (
            <ul className="list termList">
              {stock.trace.audit.map((line, i) => (
                <li key={i}>{line} · succeeded</li>
              ))}
            </ul>
          )}
          {stockTab === 'memory' && (
            <ul className="list termList">
              {stockMemory.length ? (
                stockMemory.map((m, i) => (
                  <li key={i}>
                    <strong>{m.symbol}</strong> · {m.rating}
                    <br />
                    {m.memo}
                  </li>
                ))
              ) : (
                <li>No saved stock memos yet.</li>
              )}
            </ul>
          )}
        </div>
      </section>
    </section>
  )
}

function ForecastPane() {
  const stock = useStore((s) => s.stock)
  const memo = buildForecastMemo(stock)
  const metrics: Array<[string, string]> = [
    ['Price', fmt.format(stock.price)],
    ['Median Target', fmt.format(stock.medianTarget)],
    ['Expected Return', pct(stock.expected)],
    ['Confidence', pct(stock.confidence)],
  ]
  return (
    <>
      <div className="stockMetrics">
        {metrics.map(([label, value]) => (
          <div className="stockM" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div>
        <ForecastChart forecast={stock} />
      </div>
      <ul className="list termList">
        {memo.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </>
  )
}

function BacktestPane() {
  const stock = useStore((s) => s.stock)
  const bt = stock.backtest
  const metrics: Array<[string, string | number]> = [
    ['Windows', bt.windows],
    ['Hit Rate', pct(bt.hit)],
    ['Mean Error', bt.error.toFixed(2) + '%'],
    ['Drawdown', pct(bt.drawdown)],
  ]
  return (
    <>
      <div className="metrics">
        {metrics.map(([label, value]) => (
          <div className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p>
        SmartFolio ran {bt.windows} sample windows for {stock.symbol}. Hit rate estimates
        directional agreement; mean error is a prototype metric.
      </p>
    </>
  )
}
