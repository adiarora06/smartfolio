// Analyze Stock — the OpenVC-style terminal.
// Forecast / Backtest / Topology / Audit / Memory tabs over a deterministic run.

import { useEffect, useState } from 'react'
import { useStore } from '../../../store/useStore'
import { fmt, pct, title } from '../../../lib/format'
import { buildForecastMemo } from '../../../lib/ai/memo'
import { describeImpact } from '../../../lib/ai/insights'
import { AppHero, Panel, PanelHead } from '../../shared/ui'
import { ForecastChart } from '../../shared/ForecastChart'
import type { StockTab } from '../../../types'

// Topology (the agent-flow view) lives in the Open Source screen now — the
// terminal keeps only the tabs a customer acts on.
const TABS: Array<[StockTab, string]> = [
  ['forecast', 'Forecast'],
  ['backtest', 'Backtest'],
  ['audit', 'Audit Log'],
  ['memory', 'Memory'],
]

export function AnalyzeStockScreen() {
  const stock = useStore((s) => s.stock)
  const stockSource = useStore((s) => s.stockSource)
  const running = useStore((s) => s.running)
  const narrator = useStore((s) => s.narrator)
  const agentEvents = useStore((s) => s.agentEvents)
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

  // Cold-start UX: if a run takes >2.5s the free-tier server is likely waking.
  const [slowHint, setSlowHint] = useState(false)
  useEffect(() => {
    if (!running) {
      setSlowHint(false)
      return
    }
    const timer = setTimeout(() => setSlowHint(true), 2500)
    return () => clearTimeout(timer)
  }, [running])

  const run = () => {
    if (!running && ticker.trim()) void runStock(ticker, Number(horizon))
  }

  return (
    <section className="screen active" id="stock">
      <AppHero
        title="Analyze Stock"
        subtitle="Forecast, backtest, audit trail, and portfolio impact — for any ticker."
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
        <PanelHead title="Stock Analysis Terminal" subtitle="Type a ticker, press Enter." />
        <div className="body formgrid">
          <label>
            Ticker
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder="e.g. NVDA"
            />
          </label>
          <label>
            Horizon days
            <input
              type="number"
              min={7}
              max={365}
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
            />
          </label>
          <button className="primary" disabled={running || !ticker.trim()} onClick={run}>
            {running ? 'Running…' : 'Run Analysis'}
          </button>
          <button disabled={running} onClick={resetStock}>
            Reset AAPL
          </button>
        </div>
        {slowHint && running && (
          <div className="body" style={{ paddingTop: 0, color: 'var(--muted)', fontSize: 12.5 }}>
            Waking the live engine — the free-tier server sleeps when idle, the first run can
            take up to ~30s. Results stay instant after that.
          </div>
        )}
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
            {narrator === 'llm' ? ' · LLM memo' : ''}
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
          {stockTab === 'audit' && (
            <ul className="list termList">
              {agentEvents
                ? agentEvents.map((e, i) => (
                    <li key={i}>
                      <strong>{e.agent}</strong> · {e.status} · {e.durationMs.toFixed(1)}ms
                      <br />
                      {e.detail}
                    </li>
                  ))
                : stock.trace.audit.map((line, i) => <li key={i}>{line} · succeeded</li>)}
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
  const impact = useStore((s) => s.impact)
  const serverMemo = useStore((s) => s.serverMemo)

  // Server-narrated memo when the API produced one; local template otherwise.
  const memo =
    serverMemo ?? [
      ...buildForecastMemo(stock),
      ...(impact ? describeImpact(impact, stock.symbol) : []),
    ]

  const metrics: Array<[string, string]> = [
    ['Price', fmt.format(stock.price)],
    ['Median Target', fmt.format(stock.medianTarget)],
    ['Expected Return', pct(stock.expected)],
    ['Confidence', pct(stock.confidence)],
  ]

  const impactFlags = impact
    ? impact.triggersSingleStockFlag && impact.triggersSectorFlag
      ? 'Stock + Sector'
      : impact.triggersSingleStockFlag
        ? 'Single-stock'
        : impact.triggersSectorFlag
          ? 'Sector'
          : 'None'
    : 'None'

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
      {impact && (
        <>
          <div style={{ color: '#93c5fd', fontSize: 12, fontWeight: 850, textTransform: 'uppercase' }}>
            Portfolio impact — if added to your holdings
          </div>
          <div className="stockMetrics">
            <div className="stockM">
              <span>Position Size</span>
              <strong>{fmt.format(impact.addedValue)}</strong>
            </div>
            <div className="stockM">
              <span>New Weight</span>
              <strong>{pct(impact.newWeight)}</strong>
            </div>
            <div className="stockM">
              <span>{title(impact.sector)} After</span>
              <strong>{pct(impact.sectorWeightAfter)}</strong>
            </div>
            <div className="stockM">
              <span>Flags Triggered</span>
              <strong style={{ color: impactFlags === 'None' ? '#5eead4' : '#f59e0b' }}>
                {impactFlags}
              </strong>
            </div>
          </div>
        </>
      )}
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
