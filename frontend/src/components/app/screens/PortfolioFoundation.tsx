import { type FormEvent, useMemo, useRef, useState } from 'react'
import { IonIcon } from '@ionic/react'
import {
  addOutline,
  checkmarkCircleOutline,
  cloudUploadOutline,
  downloadOutline,
  pulseOutline,
  timeOutline,
  trashOutline,
  walletOutline,
} from 'ionicons/icons'
import { useStore } from '../../../store/useStore'
import { calculatePerformance, type PerformancePoint } from '../../../lib/calculations/performance'
import {
  parsePortfolioCsv,
  PORTFOLIO_CSV_TEMPLATE,
  type PortfolioImportResult,
} from '../../../lib/import/portfolioCsv'
import { fmt } from '../../../lib/format'
import type { TransactionType } from '../../../types'

const ACTIVITY_TYPES: Array<[TransactionType, string]> = [
  ['deposit', 'Deposit'],
  ['withdrawal', 'Withdrawal'],
  ['buy', 'Buy'],
  ['sell', 'Sell'],
  ['dividend', 'Dividend'],
  ['fee', 'Fee'],
]

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const shortDate = (value: string): string =>
  DATE_FORMATTER.format(new Date(`${value}T12:00:00`))

const signedPct = (value: number | null): string =>
  value == null ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`

function chartPath(values: number[], width: number, height: number, min: number, max: number): string {
  const span = Math.max(max - min, 1)
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width
      const y = height - ((value - min) / span) * height
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

function PerformanceHistoryChart({ points }: { points: PerformancePoint[] }) {
  if (points.length < 2) {
    return (
      <div className="foundationChartEmpty">
        <IonIcon icon={timeOutline} />
        <strong>Two valuation dates unlock performance</strong>
        <span>Import history or record another valuation later.</span>
      </div>
    )
  }
  const width = 640
  const height = 184
  const portfolio = points.map((point) => point.portfolioIndex)
  const benchmark = points.map((point) => point.benchmarkIndex).filter((value): value is number => value != null)
  const allValues = [...portfolio, ...benchmark]
  const min = Math.min(...allValues) - 2
  const max = Math.max(...allValues) + 2
  const portfolioPath = chartPath(portfolio, width, height, min, max)
  const benchmarkPath = benchmark.length === points.length
    ? chartPath(benchmark, width, height, min, max)
    : ''
  const lastPoint = points[points.length - 1]
  const lastPortfolioValue = portfolio[portfolio.length - 1]

  return (
    <figure className="foundationChart">
      <svg
        viewBox={`0 0 ${width} ${height + 26}`}
        role="img"
        aria-label={`Cash-flow-adjusted portfolio performance from ${points[0].date} to ${lastPoint.date}`}
      >
        <defs>
          <linearGradient id="foundation-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#48b9a8" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#48b9a8" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={height} x2={width} y2={height} className="foundationChartAxis" />
        <path d={`${portfolioPath} L ${width} ${height} L 0 ${height} Z`} className="foundationChartArea" />
        {benchmarkPath && <path d={benchmarkPath} className="foundationBenchmarkLine" />}
        <path d={portfolioPath} className="foundationPortfolioLine" />
        <circle
          cx={width}
          cy={height - ((lastPortfolioValue - min) / Math.max(max - min, 1)) * height}
          r="5"
          className="foundationPortfolioDot"
        />
        <text x="0" y={height + 22}>{shortDate(points[0].date)}</text>
        <text x={width} y={height + 22} textAnchor="end">{shortDate(lastPoint.date)}</text>
      </svg>
      <figcaption>
        <span><i className="portfolioLegend" />Portfolio</span>
        {benchmarkPath && <span><i className="benchmarkLegend" />Benchmark</span>}
      </figcaption>
    </figure>
  )
}

function sourceLabel(source: ReturnType<typeof calculatePerformance>['source']): string {
  if (source === 'demo') return 'Demo history'
  if (source === 'imported') return 'Imported history'
  if (source === 'mixed') return 'Mixed sources'
  return 'Recorded history'
}

export function PortfolioFoundation({ currentValue }: { currentValue: number }) {
  const transactions = useStore((state) => state.transactions)
  const valuations = useStore((state) => state.valuations)
  const applyPortfolioImport = useStore((state) => state.applyPortfolioImport)
  const addTransaction = useStore((state) => state.addTransaction)
  const removeTransaction = useStore((state) => state.removeTransaction)
  const recordValuation = useStore((state) => state.recordValuation)
  const performance = useMemo(
    () => calculatePerformance(transactions, valuations),
    [transactions, valuations],
  )
  const fileInput = useRef<HTMLInputElement>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [importResult, setImportResult] = useState<PortfolioImportResult | null>(null)
  const [importName, setImportName] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [type, setType] = useState<TransactionType>('deposit')
  const [symbol, setSymbol] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')

  const latestActivity = useMemo(
    () => [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    [transactions],
  )

  const handleFile = async (file?: File) => {
    if (!file) return
    setImportName(file.name)
    setImportResult(parsePortfolioCsv(await file.text()))
    setImportOpen(true)
  }

  const applyImport = () => {
    if (!importResult) return
    applyPortfolioImport(importResult)
    setImportOpen(false)
    setImportResult(null)
    setImportName('')
    if (fileInput.current) fileInput.current.value = ''
  }

  const downloadTemplate = () => {
    const blob = new Blob([PORTFOLIO_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'smartfolio-import-template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const saveActivity = (event: FormEvent) => {
    event.preventDefault()
    const parsedAmount = Number(amount)
    if (!date || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return
    addTransaction({
      date,
      type,
      symbol: symbol.trim().toUpperCase() || null,
      amount: parsedAmount,
      quantity: null,
      price: null,
      description: description.trim(),
    })
    setAmount('')
    setSymbol('')
    setDescription('')
    setActivityOpen(false)
  }

  const recordToday = () => {
    recordValuation({
      date: new Date().toISOString().slice(0, 10),
      value: currentValue,
      benchmarkSymbol: performance.benchmarkSymbol,
      benchmarkValue: null,
    })
  }

  const importCount = importResult
    ? importResult.holdings.length + importResult.transactions.length + importResult.valuations.length
    : 0

  return (
    <section className="portfolioFoundation" aria-labelledby="portfolio-foundation-title">
      <header className="foundationHead">
        <div>
          <small>Portfolio foundation</small>
          <h2 id="portfolio-foundation-title">Performance & activity</h2>
          <p>Measured from dated account values and cash flows—not reconstructed from today’s holdings.</p>
        </div>
        <div className="foundationActions">
          <input
            ref={fileInput}
            className="foundationFileInput"
            type="file"
            accept=".csv,text/csv"
            aria-label="Choose portfolio CSV"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <button onClick={() => fileInput.current?.click()}>
            <IonIcon icon={cloudUploadOutline} />
            Import CSV
          </button>
          <button className="foundationPrimary" onClick={() => setActivityOpen((open) => !open)}>
            <IonIcon icon={addOutline} />
            Add activity
          </button>
        </div>
      </header>

      {(importOpen || activityOpen) && (
        <div className="foundationComposer">
          {importOpen && (
            <div className="foundationImportPreview" aria-live="polite">
              <div>
                <span className="foundationComposerIcon"><IonIcon icon={cloudUploadOutline} /></span>
                <span>
                  <small>CSV preview</small>
                  <strong>{importName || 'Portfolio import'}</strong>
                </span>
              </div>
              <div className="foundationImportCounts">
                <span><strong>{importResult?.holdings.length ?? 0}</strong> holdings</span>
                <span><strong>{importResult?.transactions.length ?? 0}</strong> activities</span>
                <span><strong>{importResult?.valuations.length ?? 0}</strong> valuations</span>
              </div>
              {!!importResult?.errors.length && (
                <ul className="foundationImportErrors">
                  {importResult.errors.slice(0, 3).map((error) => <li key={error}>{error}</li>)}
                </ul>
              )}
              <div className="foundationComposerActions">
                <button onClick={downloadTemplate}><IonIcon icon={downloadOutline} />Template</button>
                <button onClick={() => setImportOpen(false)}>Cancel</button>
                <button className="foundationPrimary" disabled={!importCount} onClick={applyImport}>
                  <IonIcon icon={checkmarkCircleOutline} />Apply import
                </button>
              </div>
            </div>
          )}
          {activityOpen && (
            <form className="foundationActivityForm" onSubmit={saveActivity}>
              <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
              <label>Type<select value={type} onChange={(event) => setType(event.target.value as TransactionType)}>{ACTIVITY_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>Symbol<input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="Optional" /></label>
              <label>Amount<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label>
              <label className="foundationDescription">Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional note" /></label>
              <div className="foundationComposerActions">
                <button type="button" onClick={() => setActivityOpen(false)}>Cancel</button>
                <button className="foundationPrimary" type="submit">Save activity</button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="foundationGrid">
        <div className="foundationPerformanceCard">
          <div className="foundationCardHead">
            <span>
              <small>{sourceLabel(performance.source)}</small>
              <strong>{performance.startDate && performance.endDate ? `${shortDate(performance.startDate)} — ${shortDate(performance.endDate)}` : 'Waiting for history'}</strong>
            </span>
            <span className={`foundationMeasured ${performance.measured ? '' : 'pending'}`}>
              {performance.measured ? 'Measured' : 'Needs history'}
            </span>
          </div>
          <div className="foundationMetrics">
            <div><span>Portfolio return</span><strong>{performance.measured ? signedPct(performance.totalReturn) : '—'}</strong><small>cash-flow adjusted</small></div>
            <div><span>vs {performance.benchmarkSymbol}</span><strong className={(performance.excessReturn ?? 0) < 0 ? 'negative' : ''}>{signedPct(performance.excessReturn)}</strong><small>{performance.benchmarkReturn == null ? 'benchmark unavailable' : `${signedPct(performance.benchmarkReturn)} benchmark`}</small></div>
            <div><span>Net contributed</span><strong>{fmt.format(performance.netContributions)}</strong><small>{fmt.format(performance.gain)} value above flows</small></div>
            <div><span>Max drawdown</span><strong>{performance.measured ? signedPct(performance.maxDrawdown) : '—'}</strong><small>{performance.observations} valuation points</small></div>
          </div>
          <PerformanceHistoryChart points={performance.points} />
        </div>

        <aside className="foundationLedger">
          <div className="foundationLedgerHead">
            <span><IonIcon icon={walletOutline} /></span>
            <div><small>Transaction ledger</small><h3>Recent activity</h3></div>
            <button onClick={recordToday}>Record today</button>
          </div>
          <div className="foundationActivityList">
            {latestActivity.map((transaction) => {
              const positive = transaction.type === 'deposit' || transaction.type === 'dividend'
              const negative = transaction.type === 'withdrawal' || transaction.type === 'fee'
              return (
                <div key={transaction.id}>
                  <span className={`foundationActivityType ${positive ? 'positive' : negative ? 'negative' : ''}`}>
                    <IonIcon icon={pulseOutline} />
                  </span>
                  <span>
                    <strong>{transaction.type}{transaction.symbol ? ` · ${transaction.symbol}` : ''}</strong>
                    <small>{shortDate(transaction.date)}{transaction.description ? ` · ${transaction.description}` : ''}</small>
                  </span>
                  <b>{positive ? '+' : negative ? '−' : ''}{fmt.format(transaction.amount)}</b>
                  <button aria-label={`Remove ${transaction.type} from ${transaction.date}`} onClick={() => removeTransaction(transaction.id)}>
                    <IonIcon icon={trashOutline} />
                  </button>
                </div>
              )
            })}
            {!latestActivity.length && <p>No activity yet. Add an entry or import a CSV.</p>}
          </div>
          <footer>
            <span>{transactions.length} activities</span>
            <span>{valuations.length} valuations</span>
            <button onClick={downloadTemplate}><IonIcon icon={downloadOutline} />CSV template</button>
          </footer>
        </aside>
      </div>
    </section>
  )
}
