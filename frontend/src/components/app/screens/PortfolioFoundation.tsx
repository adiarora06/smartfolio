import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { IonIcon } from '@ionic/react'
import {
  addOutline,
  barChartOutline,
  calendarOutline,
  checkmarkCircleOutline,
  chevronDownOutline,
  chevronUpOutline,
  cloudUploadOutline,
  downloadOutline,
  informationCircleOutline,
  pulseOutline,
  serverOutline,
  swapHorizontalOutline,
  timeOutline,
  trashOutline,
  walletOutline,
} from 'ionicons/icons'
import { useStore } from '../../../store/useStore'
import {
  calculatePerformance,
  type PerformanceSummary,
} from '../../../lib/calculations/performance'
import { apiCalculatePerformance } from '../../../lib/api/client'
import {
  filterHistoryPoints,
  summarizeHistory,
  type HistoryRange,
  type HistoryView,
} from '../../../lib/portfolioHistory'
import {
  parsePortfolioCsv,
  PORTFOLIO_CSV_TEMPLATE,
  type PortfolioImportResult,
} from '../../../lib/import/portfolioCsv'
import { fmt } from '../../../lib/format'
import type { PortfolioTransaction, TransactionType } from '../../../types'
import { PortfolioHistoryChart } from './PortfolioHistoryChart'

const ACTIVITY_TYPES: Array<[TransactionType, string]> = [
  ['deposit', 'Deposit'],
  ['withdrawal', 'Withdrawal'],
  ['buy', 'Buy'],
  ['sell', 'Sell'],
  ['dividend', 'Dividend'],
  ['fee', 'Fee'],
]

const RANGE_OPTIONS: Array<[HistoryRange, string]> = [
  ['3m', '3M'],
  ['6m', '6M'],
  ['1y', '1Y'],
  ['all', 'All'],
]

const VIEW_OPTIONS: Array<[HistoryView, string]> = [
  ['performance', 'Performance'],
  ['value', 'Value'],
  ['drawdown', 'Drawdown'],
]

type ManageTab = 'activity' | 'import' | 'coverage'
type ActivityFilter = 'all' | 'cash' | 'trades'

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const shortDate = (value: string): string =>
  DATE_FORMATTER.format(new Date(`${value}T12:00:00`))

const localDateValue = (value = new Date()): string => {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const signedPct = (value: number | null): string =>
  value == null ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`

const drawdownPct = (value: number | null): string =>
  value == null ? '—' : `${(value * 100).toFixed(1)}%`

const sourceLabel = (source: PerformanceSummary['source']): string => {
  if (source === 'demo') return 'Demo history'
  if (source === 'imported') return 'Imported history'
  if (source === 'mixed') return 'Mixed sources'
  return 'Recorded history'
}

const activityIcon = (type: TransactionType) => {
  if (type === 'buy' || type === 'sell') return swapHorizontalOutline
  if (type === 'deposit' || type === 'withdrawal') return walletOutline
  return pulseOutline
}

const matchesActivityFilter = (transaction: PortfolioTransaction, filter: ActivityFilter) => {
  if (filter === 'cash') return transaction.type === 'deposit' || transaction.type === 'withdrawal'
  if (filter === 'trades') return transaction.type === 'buy' || transaction.type === 'sell'
  return true
}

export function PortfolioFoundation({ currentValue }: { currentValue: number }) {
  const transactions = useStore((state) => state.transactions)
  const valuations = useStore((state) => state.valuations)
  const applyPortfolioImport = useStore((state) => state.applyPortfolioImport)
  const addTransaction = useStore((state) => state.addTransaction)
  const removeTransaction = useStore((state) => state.removeTransaction)
  const recordValuation = useStore((state) => state.recordValuation)
  const backendOnline = useStore((state) => state.backendOnline)

  const localPerformance = useMemo(
    () => calculatePerformance(transactions, valuations),
    [transactions, valuations],
  )
  const [range, setRange] = useState<HistoryRange>('all')
  const requestKey = useMemo(
    () => JSON.stringify({ transactions, valuations, range }),
    [range, transactions, valuations],
  )
  const [canonicalPerformance, setCanonicalPerformance] = useState<{
    key: string
    performance: PerformanceSummary
  } | null>(null)
  const [engineState, setEngineState] = useState<'loading' | 'api' | 'local'>('loading')

  useEffect(() => {
    let active = true
    if (backendOnline === false) {
      setEngineState('local')
      return () => {
        active = false
      }
    }
    setEngineState('loading')
    void apiCalculatePerformance(transactions, valuations, { preset: range })
      .then(({ performance }) => {
        if (!active) return
        setCanonicalPerformance({ key: requestKey, performance })
        setEngineState('api')
      })
      .catch(() => {
        if (active) setEngineState('local')
      })
    return () => {
      active = false
    }
  }, [backendOnline, range, requestKey, transactions, valuations])

  const performance = canonicalPerformance?.key === requestKey
    ? canonicalPerformance.performance
    : localPerformance
  const usingCanonical = canonicalPerformance?.key === requestKey && engineState === 'api'
  const fileInput = useRef<HTMLInputElement>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [manageTab, setManageTab] = useState<ManageTab>('activity')
  const [importResult, setImportResult] = useState<PortfolioImportResult | null>(null)
  const [importName, setImportName] = useState('')
  const [view, setView] = useState<HistoryView>('performance')
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all')
  const [showAllActivity, setShowAllActivity] = useState(false)
  const [date, setDate] = useState(() => localDateValue())
  const [type, setType] = useState<TransactionType>('deposit')
  const [symbol, setSymbol] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')

  const rangePoints = useMemo(
    () => usingCanonical ? performance.points : filterHistoryPoints(performance.points, range),
    [performance.points, range, usingCanonical],
  )
  const period = useMemo(() => summarizeHistory(rangePoints), [rangePoints])
  const rangeExternalFlows = useMemo(() => {
    if (!period.startDate || !period.endDate) return 0
    return transactions
      .filter(
        (transaction) =>
          transaction.date > period.startDate! && transaction.date <= period.endDate!,
      )
      .reduce((sum, transaction) => {
        if (transaction.type === 'deposit') return sum + transaction.amount
        if (transaction.type === 'withdrawal') return sum - transaction.amount
        return sum
      }, 0)
  }, [period.endDate, period.startDate, transactions])
  const investmentChange = usingCanonical
    ? performance.investmentGain ?? null
    : period.measured && period.startValue != null && period.endValue != null
      ? period.endValue - period.startValue - rangeExternalFlows
      : null
  const effectiveStart = usingCanonical
    ? performance.effectiveRange?.startDate ?? null
    : period.startDate
  const effectiveEnd = usingCanonical
    ? performance.effectiveRange?.endDate ?? null
    : period.endDate
  const rangeObservations = usingCanonical
    ? performance.coverage?.valuationPoints ?? performance.observations
    : period.observations
  const benchmarkObservations = rangePoints.filter((point) => point.benchmarkIndex != null).length
  const calculationStatus = usingCanonical
    ? performance.coverage?.calculationStatus ?? (performance.estimatedReturn == null ? 'unavailable' : 'complete')
    : 'unavailable'
  const calculationComplete = usingCanonical
    && calculationStatus === 'complete'
    && performance.estimatedReturn != null
  const displayView: HistoryView = calculationComplete ? view : 'value'
  const rangeReturn = calculationComplete ? performance.estimatedReturn ?? null : null
  const rangeBenchmarkReturn = calculationComplete ? performance.benchmarkReturn ?? null : null
  const rangeExcessReturn = calculationComplete ? performance.excessReturn ?? null : null
  const rangeDrawdown = calculationComplete ? performance.maxDrawdown ?? null : null
  const calculationLabel = usingCanonical
    ? calculationStatus === 'complete' ? 'Calculated estimate' : calculationStatus === 'partial' ? 'Partial estimate' : 'Unavailable'
    : 'Value history only'
  const sortedActivity = useMemo(
    () => [...transactions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((transaction) => matchesActivityFilter(transaction, activityFilter)),
    [activityFilter, transactions],
  )
  const visibleActivity = showAllActivity ? sortedActivity : sortedActivity.slice(0, 5)
  const symbolCount = new Set(transactions.map((item) => item.symbol).filter(Boolean)).size

  const openManager = (tab: ManageTab) => {
    setManageTab(tab)
    setManageOpen(true)
  }

  const handleFile = async (file?: File) => {
    if (!file) return
    setImportName(file.name)
    setImportResult(parsePortfolioCsv(await file.text()))
    openManager('import')
  }

  const applyImport = () => {
    if (!importResult) return
    applyPortfolioImport(importResult)
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
  }

  const recordToday = () => {
    recordValuation({
      date: localDateValue(),
      value: currentValue,
      benchmarkSymbol: performance.benchmarkSymbol,
      benchmarkValue: null,
    })
  }

  const importCount = importResult
    ? importResult.holdings.length + importResult.transactions.length + importResult.valuations.length
    : 0

  return (
    <section className="portfolioFoundation portfolioHistory" aria-labelledby="portfolio-history-title">
      <header className="foundationHead historyHead">
        <div>
          <small>Portfolio history</small>
          <h2 id="portfolio-history-title">Performance, value & activity</h2>
          <p>Explore estimates from dated account values and recorded cash flows.</p>
        </div>
        <div className="foundationActions historyHeadActions">
          <input
            ref={fileInput}
            className="foundationFileInput"
            type="file"
            accept=".csv,text/csv"
            aria-label="Choose portfolio CSV"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <button onClick={recordToday}>
            <IonIcon icon={calendarOutline} />
            Record today’s value
          </button>
          <button
            className={manageOpen ? 'foundationPrimary' : ''}
            aria-expanded={manageOpen}
            aria-controls="portfolio-history-manager"
            onClick={() => setManageOpen((open) => !open)}
          >
            <IonIcon icon={manageOpen ? chevronUpOutline : chevronDownOutline} />
            Manage history
          </button>
        </div>
      </header>

      {manageOpen && (
        <div className="historyManager" id="portfolio-history-manager">
          <div className="historyManagerTabs" role="group" aria-label="History data tools">
            <button aria-pressed={manageTab === 'activity'} className={manageTab === 'activity' ? 'active' : ''} onClick={() => setManageTab('activity')}>
              <IonIcon icon={addOutline} /> Add activity
            </button>
            <button aria-pressed={manageTab === 'import'} className={manageTab === 'import' ? 'active' : ''} onClick={() => setManageTab('import')}>
              <IonIcon icon={cloudUploadOutline} /> Import CSV
            </button>
            <button aria-pressed={manageTab === 'coverage'} className={manageTab === 'coverage' ? 'active' : ''} onClick={() => setManageTab('coverage')}>
              <IonIcon icon={informationCircleOutline} /> Data coverage
            </button>
          </div>

          {manageTab === 'activity' && (
            <form className="foundationActivityForm" onSubmit={saveActivity}>
              <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
              <label>Type<select value={type} onChange={(event) => setType(event.target.value as TransactionType)}>{ACTIVITY_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>Symbol<input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="Optional" /></label>
              <label>Amount<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label>
              <label className="foundationDescription">Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional note" /></label>
              <div className="foundationComposerActions">
                <button type="button" onClick={() => setManageOpen(false)}>Cancel</button>
                <button className="foundationPrimary" type="submit">Save activity</button>
              </div>
            </form>
          )}

          {manageTab === 'import' && (
            <div className="historyImportPanel" aria-live="polite">
              <div className="historyImportIntro">
                <span className="foundationComposerIcon"><IonIcon icon={cloudUploadOutline} /></span>
                <span>
                  <strong>{importName || 'Import portfolio history'}</strong>
                  <small>Upload holdings, account activity, and dated valuations from one CSV.</small>
                </span>
                <button onClick={() => fileInput.current?.click()}>Choose CSV</button>
                <button onClick={downloadTemplate}><IonIcon icon={downloadOutline} /> Template</button>
              </div>
              {importResult && (
                <>
                  <div className="foundationImportCounts">
                    <span><strong>{importResult.holdings.length}</strong> holdings</span>
                    <span><strong>{importResult.transactions.length}</strong> activities</span>
                    <span><strong>{importResult.valuations.length}</strong> valuations</span>
                  </div>
                  {!!importResult.errors.length && (
                    <ul className="foundationImportErrors">
                      {importResult.errors.slice(0, 3).map((error) => <li key={error}>{error}</li>)}
                    </ul>
                  )}
                  <p className="historyImportPolicy">
                    Applying replaces each category included in this file. Existing categories not included stay unchanged.
                  </p>
                  <div className="foundationComposerActions">
                    <button onClick={() => setImportResult(null)}>Clear preview</button>
                    <button className="foundationPrimary" disabled={!importCount || !!importResult.errors.length} onClick={applyImport}>
                      <IonIcon icon={checkmarkCircleOutline} />
                      {importResult.errors.length ? 'Fix errors to import' : 'Apply import'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {manageTab === 'coverage' && (
            <div className="historyCoveragePanel">
              <div className="historyCoverageStats">
                <span><strong>{calculationLabel}</strong> calculation status</span>
                <span><strong>{rangeObservations}</strong> dated values in range</span>
                <span><strong>{benchmarkObservations}</strong> benchmark points</span>
                <span><strong>Not connected</strong> daily risk series</span>
              </div>
              <div className="historyMethodNote">
                <IonIcon icon={informationCircleOutline} />
                <p>
                  {usingCanonical
                    ? 'Modified Dietz estimates returns by weighting recorded external cash flows by date. Investment gain still depends on a complete ledger. Total-value snapshots cannot establish allocation drift or holding-level return attribution.'
                    : 'Offline mode shows recorded values and cash-flow activity only. Return and drawdown estimates require the Python calculation engine. Total-value snapshots cannot establish allocation drift or holding-level return attribution.'}
                </p>
              </div>
              {!!performance.warnings?.length && usingCanonical && (
                <ul className="historyCoverageWarnings">
                  {performance.warnings.map((warning) => (
                    <li key={`${warning.code}-${warning.dates.join('-')}`}>{warning.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="historyGrid">
        <div className="historyPerformanceCard">
          <div className="historyControlBar">
            <span className="historySource">
              <small>{sourceLabel(performance.source)}</small>
              <strong>
                {effectiveStart && effectiveEnd
                  ? effectiveStart === effectiveEnd
                    ? `Effective ${shortDate(effectiveEnd)}`
                    : `${shortDate(effectiveStart)} — ${shortDate(effectiveEnd)}`
                  : 'Waiting for dated values'}
              </strong>
            </span>
            <span className={`historyEngineBadge ${usingCanonical ? '' : 'local'}`}>
              <IonIcon icon={usingCanonical ? serverOutline : timeOutline} />
              {engineState === 'loading' ? 'Updating history' : usingCanonical ? 'Backend estimate' : 'Offline values'}
            </span>
            <div className="historyViewPicker" role="group" aria-label="History chart view">
              {VIEW_OPTIONS.map(([value, label]) => (
                <button
                  aria-pressed={displayView === value}
                  className={displayView === value ? 'active' : ''}
                  disabled={value !== 'value' && !calculationComplete}
                  title={value !== 'value' && !calculationComplete ? 'Available when the backend calculation is complete' : undefined}
                  onClick={() => setView(value)}
                  key={value}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="historyRangePicker" aria-label="History time range">
              {RANGE_OPTIONS.map(([value, label]) => (
                <button aria-pressed={range === value} className={range === value ? 'active' : ''} onClick={() => setRange(value)} key={value}>{label}</button>
              ))}
            </div>
          </div>

          <div className="historyMetrics">
            <div>
              <span>Estimated return</span>
              <strong>{signedPct(rangeReturn)}</strong>
              <small>{rangeReturn != null ? `${rangeObservations} observed values in range` : usingCanonical ? 'complete valuation intervals required' : 'backend calculation required'}</small>
            </div>
            <div>
              <span>Value change after flows</span>
              <strong className={(investmentChange ?? 0) < 0 ? 'negative' : ''}>
                {investmentChange == null ? '—' : fmt.format(investmentChange)}
              </strong>
              <small>estimated from recorded flows · ledger-dependent</small>
            </div>
            <div>
              <span>Vs {performance.benchmarkSymbol}</span>
              <strong className={(rangeExcessReturn ?? 0) < 0 ? 'negative' : ''}>{signedPct(rangeExcessReturn)}</strong>
              <small>{rangeBenchmarkReturn == null ? 'benchmark coverage incomplete' : `${signedPct(rangeBenchmarkReturn)} benchmark estimate`}</small>
            </div>
            <div>
              <span>Range drawdown</span>
              <strong>{drawdownPct(rangeDrawdown)}</strong>
              <small>peak-to-trough from observed values</small>
            </div>
          </div>

          <PortfolioHistoryChart
            points={rangePoints}
            view={displayView}
            benchmarkSymbol={performance.benchmarkSymbol}
          />

          <button className="historyCoverageShortcut" onClick={() => openManager('coverage')}>
            <IonIcon icon={informationCircleOutline} />
            <span>
              <strong>{rangeObservations} valuation points · {benchmarkObservations} benchmark points</strong>
              <small>See estimation limits and future risk-data coverage</small>
            </span>
            <IonIcon icon={chevronDownOutline} />
          </button>
        </div>

        <aside className="historyActivityPanel" aria-labelledby="history-activity-title">
          <div className="historyActivityHead">
            <span><IonIcon icon={walletOutline} /></span>
            <div>
              <small>Recorded ledger</small>
              <h3 id="history-activity-title">Account activity</h3>
            </div>
            <button onClick={() => openManager('activity')}><IonIcon icon={addOutline} /> Add</button>
          </div>

          <div className="historyActivityFilters" aria-label="Activity filter">
            {([['all', 'All'], ['cash', 'Cash flows'], ['trades', 'Trades']] as Array<[ActivityFilter, string]>).map(([value, label]) => (
              <button aria-pressed={activityFilter === value} className={activityFilter === value ? 'active' : ''} onClick={() => setActivityFilter(value)} key={value}>{label}</button>
            ))}
          </div>

          <div className="historyActivityList">
            {visibleActivity.map((transaction) => {
              const positive = transaction.type === 'deposit' || transaction.type === 'dividend'
              const negative = transaction.type === 'withdrawal' || transaction.type === 'fee'
              return (
                <div className="historyActivityRow" key={transaction.id}>
                  <span className={`foundationActivityType ${positive ? 'positive' : negative ? 'negative' : ''}`}>
                    <IonIcon icon={activityIcon(transaction.type)} />
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
            {!visibleActivity.length && (
              <div className="historyActivityEmpty">
                <IonIcon icon={barChartOutline} />
                <strong>No matching activity</strong>
                <small>Add an entry or change the filter.</small>
              </div>
            )}
          </div>

          <footer className="historyActivityFooter">
            <span>{transactions.length} entries · {symbolCount} symbols</span>
            {sortedActivity.length > 5 && (
              <button onClick={() => setShowAllActivity((show) => !show)}>
                {showAllActivity ? 'Show recent' : `View all ${sortedActivity.length}`}
              </button>
            )}
          </footer>
        </aside>
      </div>
    </section>
  )
}
