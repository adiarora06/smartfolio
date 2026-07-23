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
  ['impact', 'Portfolio Impact'],
  ['backtest', 'Backtest'],
  ['inputs', 'Model Inputs'],
  ['audit', 'Audit Log'],
  ['memory', 'Memory'],
  ['history', 'History'],
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
          {stockTab === 'impact' && <ImpactPane />}
          {stockTab === 'inputs' && <InputsPane />}
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
          {stockTab === 'history' && <HistoryPane />}
        </div>
      </section>
    </section>
  )
}

function HistoryPane() {
  const history = useStore((s) => s.history)
  const backendOnline = useStore((s) => s.backendOnline)
  const loadStoredRun = useStore((s) => s.loadStoredRun)

  if (!backendOnline) {
    return (
      <ul className="list termList">
        <li>History lives on the backend — reconnect to see past runs.</li>
      </ul>
    )
  }
  if (!history.length) {
    return (
      <ul className="list termList">
        <li>No runs stored yet — every Run Analysis lands here automatically.</li>
      </ul>
    )
  }
  return (
    <ul className="list termList">
      {history.map((run) => (
        <li
          key={run.id}
          onClick={() => void loadStoredRun(run.id)}
          style={{ cursor: 'pointer' }}
          title="Replay this run"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <strong>
              {run.symbol} · {run.rating}
            </strong>
            <span style={{ color: '#93c5fd', fontSize: 12 }}>{run.days}d</span>
          </div>
          <span style={{ color: '#93c5fd', fontSize: 12 }}>
            {new Date(run.createdAt).toLocaleString()} · {run.source} · tap to replay
          </span>
        </li>
      ))}
    </ul>
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
    ['50% Band', `${fmt.format(stock.q25Target)} – ${fmt.format(stock.q75Target)}`],
    ['P(Gain)', pct(stock.probGain)],
    ['P(Beat Market)', pct(stock.probBeatMarket)],
    ['P(−20% Drawdown)', pct(stock.probDrawdown20)],
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

/** Portfolio impact — weights first, then what the risk model says. */
function ImpactPane() {
  const stock = useStore((s) => s.stock)
  const impact = useStore((s) => s.impact)

  if (!impact) {
    return (
      <ul className="list termList">
        <li>
          No holdings sent with this run — add positions in Portfolio and re-run to see the
          what-if impact.
        </li>
      </ul>
    )
  }

  const flags =
    impact.triggersSingleStockFlag && impact.triggersSectorFlag
      ? 'Stock + Sector'
      : impact.triggersSingleStockFlag
        ? 'Single-stock'
        : impact.triggersSectorFlag
          ? 'Sector'
          : 'None'

  // The headline of this pane: weight and risk share are different numbers,
  // and the gap between them is what a weights-only view hides.
  const riskSkew = impact.newWeight > 0 ? impact.riskContribution / impact.newWeight : 1

  return (
    <>
      <SectionLabel>Position</SectionLabel>
      <div className="stockMetrics">
        <Metric label="Position Size" value={fmt.format(impact.addedValue)} />
        <Metric label="New Weight" value={pct(impact.newWeight)} />
        <Metric label={`${title(impact.sector)} After`} value={pct(impact.sectorWeightAfter)} />
        <Metric
          label="Concentration Flags"
          value={flags}
          tone={flags === 'None' ? 'good' : 'warn'}
        />
      </div>

      <SectionLabel>Risk effect</SectionLabel>
      <div className="stockMetrics">
        <Metric
          label="Portfolio Volatility"
          value={`${pct(impact.volBefore)} → ${pct(impact.volAfter)}`}
          tone={impact.volDelta > 0 ? 'warn' : 'good'}
        />
        <Metric
          label="Portfolio Beta"
          value={`${impact.betaBefore.toFixed(2)} → ${impact.betaAfter.toFixed(2)}`}
        />
        <Metric
          label="Share of Total Risk"
          value={pct(impact.riskContribution)}
          tone={riskSkew > 1.25 ? 'warn' : 'good'}
        />
        <Metric
          label="95% VaR (horizon)"
          value={`${pct(impact.var95Before)} → ${pct(impact.var95After)}`}
        />
        <Metric
          label="Effective Positions"
          value={`${impact.effectivePositionsBefore.toFixed(1)} → ${impact.effectivePositionsAfter.toFixed(1)}`}
        />
        <Metric
          label="Return per Unit Risk"
          value={impact.improvesRiskAdjustedReturn ? 'Improves' : 'Does not improve'}
          tone={impact.improvesRiskAdjustedReturn ? 'good' : 'warn'}
        />
      </div>

      {riskSkew > 1.25 && (
        <p style={{ color: '#f59e0b', fontSize: 13 }}>
          At {pct(impact.newWeight)} of value this position would carry{' '}
          {pct(impact.riskContribution)} of total portfolio risk — roughly {riskSkew.toFixed(1)}×
          its weight, because risk contribution scales with volatility and not just size.
        </p>
      )}

      <SectionLabel>Sizing</SectionLabel>
      <p style={{ fontSize: 13 }}>
        Holding portfolio volatility at or below the {pct(impact.volCeiling)} ceiling for this
        risk profile implies a position of at most{' '}
        <strong>{pct(impact.maxWeightForProfile)}</strong> of the portfolio. The proposed trade
        is {pct(impact.newWeight)}.
      </p>

      {impact.topRiskContributors.length > 0 && (
        <>
          <SectionLabel>Where the risk sits, after the trade</SectionLabel>
          <ul className="list termList">
            {impact.topRiskContributors.map((c) => (
              <li key={c.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <strong>{c.label}</strong>
                  <span style={{ color: '#93c5fd', fontSize: 12 }}>
                    {pct(c.weight)} of value · {pct(c.riskContribution)} of risk
                  </span>
                </div>
                <span style={{ color: '#93c5fd', fontSize: 12 }}>
                  σ {pct(c.volatility)} · β {c.beta.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
        Risk figures use a single-index model: each holding is market exposure (beta) plus an
        independent idiosyncratic component. Per-sector betas and volatilities are documented
        assumptions; {stock.symbol}&apos;s volatility is{' '}
        {stock.inputs?.volMeasured ? 'measured from its price history' : 'a reference estimate'}.
      </p>
    </>
  )
}

/** The honesty panel: what the model ran on, and how much of it was measured. */
function InputsPane() {
  const stock = useStore((s) => s.stock)
  const inputs = stock.inputs
  const stats = stock.stats
  const fundamentals = stock.fundamentals

  if (!inputs) {
    return (
      <ul className="list termList">
        <li>No input trace on this run.</li>
      </ul>
    )
  }

  return (
    <>
      <SectionLabel>Fitted parameters</SectionLabel>
      <div className="stockMetrics">
        <Metric
          label="Volatility (σ)"
          value={pct(inputs.sigma)}
          tone={inputs.volMeasured ? 'good' : 'warn'}
        />
        <Metric label="Drift (μ)" value={pct(inputs.mu)} />
        <Metric label="Raw Signal" value={pct(inputs.driftRaw)} />
        <Metric label="Shrunk Toward Market" value={pct(1 - inputs.shrinkage)} />
        <Metric
          label="Data Completeness"
          value={pct(inputs.dataCompleteness)}
          tone={inputs.dataCompleteness > 0.7 ? 'good' : 'warn'}
        />
        <Metric
          label="Quality Score"
          value={`${stock.quality.toFixed(2)}${inputs.qualityMeasured ? '' : ' (ref)'}`}
        />
      </div>

      {(inputs.warnings ?? []).length > 0 && (
        <div>
          <SectionLabel>Data integrity</SectionLabel>
          <ul className="list termList">
            {(inputs.warnings ?? []).map((w, i) => (
              <li key={i} style={{ color: '#f59e0b' }}>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {inputs.staleInputs.length > 0 && (
        <p style={{ color: '#f59e0b', fontSize: 13 }}>
          Served from cache past its refresh window: {inputs.staleInputs.join(', ')}. The provider
          was unavailable or rate-limited, so these inputs are older than they should be.
        </p>
      )}

      <SectionLabel>Drift signals</SectionLabel>
      {inputs.signals.length ? (
        <ul className="list termList">
          {inputs.signals.map((s) => (
            <li key={s.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <strong>{title(s.name)}</strong>
                <span style={{ color: '#93c5fd', fontSize: 12 }}>
                  {pct(s.value)} · weight {s.weight.toFixed(2)}
                </span>
              </div>
              <span style={{ color: '#93c5fd', fontSize: 12 }}>{s.detail}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ fontSize: 13 }}>
          No measured signals available — the drift estimate is the market baseline. This is what
          the engine does when it has nothing real to work from, rather than inventing a trend.
        </p>
      )}

      {stats && (
        <>
          <SectionLabel>Measured from {stats.observations} sessions</SectionLabel>
          <div className="stockMetrics">
            <Metric label="Vol (EWMA)" value={pct(stats.vol)} />
            <Metric label="Vol (simple)" value={pct(stats.volSimple)} />
            {stats.momentum12m1 != null && (
              <Metric label="12-1 Momentum" value={pct(stats.momentum12m1)} />
            )}
            {stats.return3m != null && <Metric label="3-Month Return" value={pct(stats.return3m)} />}
            <Metric label="Max Drawdown" value={pct(stats.maxDrawdown)} />
            {stats.pctOf52wRange != null && (
              <Metric label="52-Week Position" value={pct(stats.pctOf52wRange)} />
            )}
            {stats.sharpeTrailing != null && (
              <Metric label="Trailing Sharpe" value={stats.sharpeTrailing.toFixed(2)} />
            )}
          </div>
        </>
      )}

      {fundamentals && (
        <>
          <SectionLabel>Fundamentals</SectionLabel>
          <div className="stockMetrics">
            {fundamentals.beta != null && <Metric label="Beta" value={fundamentals.beta.toFixed(2)} />}
            {fundamentals.peRatio != null && <Metric label="P/E" value={fundamentals.peRatio.toFixed(1)} />}
            {fundamentals.pegRatio != null && <Metric label="PEG" value={fundamentals.pegRatio.toFixed(2)} />}
            {fundamentals.profitMargin != null && (
              <Metric label="Profit Margin" value={pct(fundamentals.profitMargin)} />
            )}
            {fundamentals.returnOnEquity != null && (
              <Metric label="ROE" value={pct(fundamentals.returnOnEquity)} />
            )}
            {fundamentals.revenueGrowthYoy != null && (
              <Metric label="Revenue Growth" value={pct(fundamentals.revenueGrowthYoy)} />
            )}
            {fundamentals.analystTarget != null && (
              <Metric label="Analyst Target" value={fmt.format(fundamentals.analystTarget)} />
            )}
          </div>
        </>
      )}

      {stock.sentiment != null && (
        <p style={{ fontSize: 13 }}>
          News tone {stock.sentiment >= 0 ? '+' : ''}
          {stock.sentiment.toFixed(2)} across {stock.sentimentArticles} tagged articles,
          relevance-weighted.
        </p>
      )}

      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
        Provenance: {inputs.sources.join(' · ') || 'offline reference'}
      </p>
    </>
  )
}

/** Backtest — calibration first, because that is what validates the band. */
function BacktestPane() {
  const stock = useStore((s) => s.stock)
  const bt = stock.backtest

  if (!bt.measured) {
    return (
      <>
        <p style={{ fontSize: 13 }}>
          Not enough price history to replay the engine for {stock.symbol}, so there is no
          measured track record to show. A walk-forward backtest needs roughly a year of daily
          closes before the first scoreable window plus one full horizon after the last.
        </p>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          This panel deliberately shows nothing rather than a plausible-looking number derived
          from the same assumptions the forecast already uses — that would be scoring the model
          against itself.
        </p>
      </>
    )
  }

  const cov50 = bt.coverage50 ?? 0
  const cov90 = bt.coverage90 ?? 0
  const wellCalibrated = Math.abs(cov50 - 0.5) < 0.15 && Math.abs(cov90 - 0.9) < 0.1

  return (
    <>
      <SectionLabel>Calibration — did reality land inside the bands?</SectionLabel>
      <div className="stockMetrics">
        <Metric
          label="50% Band Coverage"
          value={`${pct(cov50)} (target 50%)`}
          tone={Math.abs(cov50 - 0.5) < 0.15 ? 'good' : 'warn'}
        />
        <Metric
          label="90% Band Coverage"
          value={`${pct(cov90)} (target 90%)`}
          tone={Math.abs(cov90 - 0.9) < 0.1 ? 'good' : 'warn'}
        />
        <Metric label="Directional Hit" value={pct(bt.hit)} />
        <Metric label="Median Abs. Error" value={bt.error.toFixed(2) + '%'} />
        <Metric
          label="Bias"
          value={bt.bias != null ? pct(bt.bias) : '—'}
          tone={bt.bias != null && Math.abs(bt.bias) < 0.03 ? 'good' : 'warn'}
        />
        <Metric label="Realized Max Drawdown" value={pct(bt.drawdown)} />
      </div>

      <p style={{ fontSize: 13 }}>
        {wellCalibrated
          ? `Over ${bt.windows} replayed windows the bands were about the right width: outcomes fell inside them close to the rate the model claims.`
          : cov50 > 0.5
            ? `Over ${bt.windows} replayed windows outcomes landed inside the bands more often than the model claims — the cone is wider than it needs to be, understating conviction.`
            : `Over ${bt.windows} replayed windows outcomes landed inside the bands less often than the model claims — the cone is too narrow, overstating conviction.`}
        {bt.bias != null && Math.abs(bt.bias) >= 0.03 && (
          <>
            {' '}
            The median forecast also ran {bt.bias > 0 ? 'optimistic' : 'pessimistic'} by{' '}
            {pct(Math.abs(bt.bias))} on average.
          </>
        )}
      </p>

      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
        Method: at each of {bt.windows} past origins ({bt.firstOrigin} to {bt.lastOrigin}) the
        price series is truncated to that date, the same estimator is refit on what was visible
        then, and the band it produced is compared to the price {Math.round(stock.days)} days
        later. No data after an origin reaches its own forecast.
        {bt.independentWindows != null && (
          <>
            {' '}
            Those windows overlap, so they span about {bt.independentWindows} independent
            horizons — read the coverage figures against that, not against {bt.windows}.
          </>
        )}
      </p>
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: '#93c5fd',
        fontSize: 12,
        fontWeight: 850,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
      }}
    >
      {children}
    </div>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: 'good' | 'warn'
}) {
  const color = tone === 'good' ? '#5eead4' : tone === 'warn' ? '#f59e0b' : undefined
  return (
    <div className="stockM">
      <span>{label}</span>
      <strong style={color ? { color } : undefined}>{value}</strong>
    </div>
  )
}
