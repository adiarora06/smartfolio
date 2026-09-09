import { useMemo, useState, type FormEvent } from 'react'
import { IonIcon } from '@ionic/react'
import {
  checkmarkCircleOutline,
  chevronDownOutline,
  chevronUpOutline,
  refreshOutline,
  trashOutline,
  walletOutline,
  warningOutline,
} from 'ionicons/icons'
import { useStore } from '../../../store/useStore'
import { fmt, pct, title } from '../../../lib/format'
import { apiAnalyzePositions } from '../../../lib/api/client'
import {
  applyHoldingPatch,
  holdingGain,
  holdingGainPct,
  holdingTrackingStatus,
  normalizeHolding,
  summarizeHoldingCoverage,
} from '../../../lib/holdings'
import type { AssetClass, Holding, HoldingType } from '../../../types'

type HoldingFilter = 'all' | 'complete' | 'needs_details'
type EditorMode = 'value' | 'shares'

const FILTER_OPTIONS: Array<[HoldingFilter, string]> = [
  ['all', 'All'],
  ['complete', 'Fully tracked'],
  ['needs_details', 'Needs details'],
]

const TYPE_OPTIONS: HoldingType[] = ['stock', 'etf', 'cash']
const ASSET_OPTIONS: Array<[AssetClass, string]> = [
  ['us_equity', 'US Equity'],
  ['intl_equity', 'Intl Equity'],
  ['bonds', 'Bonds'],
  ['cash', 'Cash'],
  ['alternatives', 'Alternatives'],
  ['crypto', 'Crypto'],
  ['other', 'Other'],
]

const sourceLabel = (source?: Holding['source']): string => {
  if (source === 'plaid') return 'Plaid'
  if (source === 'imported') return 'CSV import'
  if (source === 'analysis') return 'Analysis'
  if (source === 'demo') return 'Demo'
  return 'Manual'
}

const statusLabel = (holding: Holding): string => {
  const status = holdingTrackingStatus(holding)
  if (status === 'complete') return 'Fully tracked'
  if (status === 'priced') return 'Price tracked'
  if (status === 'basis_only') return 'Cost basis only'
  return 'Value only'
}

const dateLabel = (value?: string | null): string => {
  if (!value) return 'Not priced'
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(parsed)
}

const numberOrNull = (value: string): number | null => {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const inputNumber = (value?: number | null): string => value == null ? '' : String(value)

const localDateValue = (): string => {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
}

function HoldingEditor({
  holding,
  onCancel,
  onDelete,
  onSave,
}: {
  holding: Holding
  onCancel: () => void
  onDelete: () => void
  onSave: (holding: Holding) => void
}) {
  const normalized = normalizeHolding(holding)
  const holdingIsCash = holding.type === 'cash' || holding.asset === 'cash'
  const [mode, setMode] = useState<EditorMode>(
    !holdingIsCash && (holding.quantity != null || holding.currentPrice != null || holding.averageCost != null)
      ? 'shares'
      : 'value',
  )
  const [symbol, setSymbol] = useState(holding.symbol)
  const [name, setName] = useState(holding.name)
  const [type, setType] = useState<HoldingType>(holding.type)
  const [asset, setAsset] = useState<AssetClass>(holding.asset)
  const [sector, setSector] = useState(holding.sector)
  const [value, setValue] = useState(inputNumber(holding.value))
  const [quantity, setQuantity] = useState(inputNumber(holding.quantity))
  const [currentPrice, setCurrentPrice] = useState(inputNumber(holding.currentPrice))
  const [averageCost, setAverageCost] = useState(inputNumber(holding.averageCost))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isCash = type === 'cash' || asset === 'cash'

  const parsedQuantity = numberOrNull(quantity)
  const parsedPrice = numberOrNull(currentPrice)
  const parsedAverageCost = numberOrNull(averageCost)
  const derivedValue = parsedQuantity != null && parsedPrice != null
    ? parsedQuantity * parsedPrice
    : null
  const derivedBasis = parsedQuantity != null && parsedAverageCost != null
    ? parsedQuantity * parsedAverageCost
    : null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const cleanedSymbol = symbol.trim().toUpperCase()
    if (!cleanedSymbol) {
      setError('Enter a symbol before saving this position.')
      return
    }

    const sharedPatch: Partial<Holding> = {
      symbol: cleanedSymbol,
      name: name.trim() || cleanedSymbol,
      type,
      asset,
      sector: sector.trim() || (asset === 'cash' ? 'cash' : 'unknown'),
    }

    if (mode === 'value' || type === 'cash' || asset === 'cash') {
      const parsedValue = numberOrNull(value)
      if (parsedValue == null) {
        setError('Enter a non-negative market value.')
        return
      }
      onSave(applyHoldingPatch(normalized, {
        ...sharedPatch,
        value: parsedValue,
        quantity: null,
        currentPrice: null,
        averageCost: null,
        costBasis: null,
        priceAsOf: null,
        priceSource: null,
      }))
      return
    }

    if (parsedQuantity == null || parsedQuantity <= 0 || parsedPrice == null || parsedPrice <= 0) {
      setError('Shares and current price must both be greater than zero for share tracking.')
      return
    }
    const priceChanged = parsedPrice !== normalized.currentPrice
    onSave(applyHoldingPatch(normalized, {
      ...sharedPatch,
      quantity: parsedQuantity,
      currentPrice: parsedPrice,
      averageCost: parsedAverageCost,
      costBasis: parsedAverageCost == null ? null : normalized.costBasis,
      priceAsOf: priceChanged ? localDateValue() : normalized.priceAsOf,
      priceSource: priceChanged ? 'manual' : normalized.priceSource,
    }))
  }

  return (
    <form className="holdingEditor" onSubmit={submit}>
      <header className="holdingEditorHead">
        <div>
          <small>Position details</small>
          <h3>Edit {holding.symbol || 'new holding'}</h3>
        </div>
        {!isCash && (
          <div className="holdingModePicker" role="group" aria-label="Holding tracking method">
            <button
              type="button"
              aria-pressed={mode === 'value'}
              className={mode === 'value' ? 'active' : ''}
              onClick={() => setMode('value')}
            >
              Value only
            </button>
            <button
              type="button"
              aria-pressed={mode === 'shares'}
              className={mode === 'shares' ? 'active' : ''}
              onClick={() => setMode('shares')}
            >
              Shares & cost
            </button>
          </div>
        )}
      </header>

      <div className="holdingEditorCore">
        <label>
          Symbol
          <input value={symbol} maxLength={16} onChange={(event) => setSymbol(event.target.value.toUpperCase())} />
        </label>
        {mode === 'value' || isCash ? (
          <label>
            Market value
            <span className="holdingMoneyInput"><b>$</b><input type="number" min="0" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} /></span>
          </label>
        ) : (
          <>
            <label>
              Shares
              <input type="number" min="0.000001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </label>
            <label>
              Current price
              <span className="holdingMoneyInput"><b>$</b><input type="number" min="0.01" step="0.01" value={currentPrice} onChange={(event) => setCurrentPrice(event.target.value)} /></span>
            </label>
            <label>
              Average cost <small>Optional</small>
              <span className="holdingMoneyInput"><b>$</b><input type="number" min="0" step="0.01" value={averageCost} onChange={(event) => setAverageCost(event.target.value)} /></span>
            </label>
          </>
        )}
      </div>

      {mode === 'value' && !isCash && (
        normalized.quantity != null
        || normalized.currentPrice != null
        || normalized.averageCost != null
        || normalized.costBasis != null
      ) && (
        <p className="holdingModeWarning">
          <IonIcon icon={warningOutline} />
          Saving as Value only removes the saved shares, price, and cost-basis details for this position.
        </p>
      )}

      {mode === 'shares' && !isCash && (
        <div className="holdingDerivedStrip" aria-live="polite">
          <span><small>Market value</small><strong>{derivedValue == null ? '—' : fmt.format(derivedValue)}</strong></span>
          <span><small>Cost basis</small><strong>{derivedBasis == null ? '—' : fmt.format(derivedBasis)}</strong></span>
          <span><small>Unrealized gain</small><strong className={derivedValue != null && derivedBasis != null && derivedValue < derivedBasis ? 'negative' : ''}>{derivedValue == null || derivedBasis == null ? '—' : fmt.format(derivedValue - derivedBasis)}</strong></span>
        </div>
      )}

      <details className="holdingClassification">
        <summary>Classification</summary>
        <div>
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>
            Type
            <select value={type} onChange={(event) => setType(event.target.value as HoldingType)}>
              {TYPE_OPTIONS.map((option) => <option value={option} key={option}>{title(option)}</option>)}
            </select>
          </label>
          <label>
            Asset class
            <select value={asset} onChange={(event) => setAsset(event.target.value as AssetClass)}>
              {ASSET_OPTIONS.map(([option, label]) => <option value={option} key={option}>{label}</option>)}
            </select>
          </label>
          <label>Sector<input value={sector} onChange={(event) => setSector(event.target.value)} /></label>
        </div>
      </details>

      <p className="holdingEditorProvenance">
        Source: <strong>{sourceLabel(holding.source)}</strong>
        {holding.priceSource ? <> · Last quote: <strong>{holding.priceSource}</strong> on {dateLabel(holding.priceAsOf)}</> : null}
      </p>

      {error && <p className="holdingEditorError" role="alert"><IonIcon icon={warningOutline} />{error}</p>}

      <footer className="holdingEditorActions">
        {confirmDelete ? (
          <div className="holdingDeleteConfirm" role="alert">
            <span>Delete {holding.symbol || 'this position'}?</span>
            <button type="button" onClick={() => setConfirmDelete(false)}>Keep it</button>
            <button className="danger" type="button" onClick={onDelete}>Delete</button>
          </div>
        ) : (
          <button className="holdingDeleteButton" type="button" onClick={() => setConfirmDelete(true)}>
            <IonIcon icon={trashOutline} /> Delete position
          </button>
        )}
        <span>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className="primary" type="submit">Save position</button>
        </span>
      </footer>
    </form>
  )
}

export function HoldingsWorkspace({
  expandedId,
  onExpandedIdChange,
  draftId,
  onDraftResolved,
}: {
  expandedId: string | null
  onExpandedIdChange: (id: string | null) => void
  draftId: string | null
  onDraftResolved: () => void
}) {
  const holdings = useStore((state) => state.holdings)
  const replaceHolding = useStore((state) => state.replaceHolding)
  const removeHolding = useStore((state) => state.removeHolding)
  const replaceHoldings = useStore((state) => state.replaceHoldings)
  const [filter, setFilter] = useState<HoldingFilter>('all')
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const coverage = useMemo(() => summarizeHoldingCoverage(holdings), [holdings])
  const valueOnlyCount = useMemo(
    () => holdings.filter((holding) => holdingTrackingStatus(holding) === 'value_only').length,
    [holdings],
  )
  const visibleHoldings = useMemo(
    () => holdings
      .map((holding, index) => ({ holding, index }))
      .filter(({ holding }) => {
        const status = holdingTrackingStatus(holding)
        if (filter === 'complete') return status === 'complete'
        if (filter === 'needs_details') return status !== 'complete'
        return true
      }),
    [filter, holdings],
  )
  const totalValue = coverage.totalValue || 1

  const isBlankDraft = (holding: Holding): boolean =>
    Boolean(
      draftId
      && holding.id === draftId
      && !holding.symbol.trim()
      && !holding.name.trim()
      && holding.value === 0
      && holding.quantity == null
      && holding.currentPrice == null
      && holding.averageCost == null
      && holding.costBasis == null,
    )

  const changeExpanded = (nextId: string | null) => {
    const openDraft = holdings.find((holding) => holding.id === draftId)
    if (openDraft && expandedId === draftId && nextId !== draftId && isBlankDraft(openDraft)) {
      removeHolding(draftId!)
      onDraftResolved()
    }
    onExpandedIdChange(nextId)
  }

  const saveHolding = (holding: Holding, index: number, next: Holding) => {
    if (holding.id) replaceHolding(holding.id, next)
    else replaceHoldings(holdings.map((item, itemIndex) => itemIndex === index ? next : item))
    if (holding.id === draftId) onDraftResolved()
    setNotice(`${next.symbol || 'Position'} was updated.`)
    setRefreshError(null)
    onExpandedIdChange(null)
  }

  const deleteHolding = (holding: Holding, index: number) => {
    if (holding.id) removeHolding(holding.id)
    else replaceHoldings(holdings.filter((_, itemIndex) => itemIndex !== index))
    if (holding.id === draftId) onDraftResolved()
    setNotice(`${holding.symbol || 'Position'} was removed.`)
    setRefreshError(null)
    onExpandedIdChange(null)
  }

  const refreshPrices = async () => {
    const blankDraft = holdings.find((holding) => isBlankDraft(holding))
    const holdingsToRefresh = holdings.filter((holding) => !isBlankDraft(holding))
    const requestSignature = JSON.stringify(holdingsToRefresh)
    setRefreshing(true)
    setNotice(null)
    setRefreshError(null)
    if (blankDraft?.id) {
      removeHolding(blankDraft.id)
      onDraftResolved()
    }
    onExpandedIdChange(null)
    try {
      const result = await apiAnalyzePositions(holdingsToRefresh, { refreshPrices: true })
      if (JSON.stringify(useStore.getState().holdings) !== requestSignature) {
        setNotice('Portfolio changed; refresh again. Your edits were kept.')
        return
      }
      replaceHoldings(result.holdings)
      const failedRefreshes = new Set(
        result.warnings
          .filter((warning) =>
            warning.code === 'offline_reference_not_applied'
            || warning.code === 'price_unavailable',
          )
          .map((warning) => warning.holdingId || `symbol:${warning.symbol}`),
      )
      const refreshed = holdingsToRefresh.filter(
        (holding) =>
          holding.type !== 'cash'
          && Boolean(holding.symbol.trim())
          && !failedRefreshes.has(holding.id || `symbol:${holding.symbol}`),
      ).length
      setNotice(
        refreshed > 0
          ? `Updated prices for ${refreshed} ${refreshed === 1 ? 'position' : 'positions'}.`
          : 'No provider prices were applied. Your saved values were not changed.',
      )
    } catch {
      setRefreshError('Prices could not be refreshed. Your saved values were not changed.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section className="holdingsWorkspace" aria-labelledby="holdings-workspace-title">
      <header className="holdingsWorkspaceHead">
        <div>
          <small>Portfolio positions</small>
          <h2 id="holdings-workspace-title">Holdings</h2>
          <p>Edit one position at a time while the portfolio totals stay in view.</p>
        </div>
        <button
          className="holdingsRefreshButton"
          type="button"
          title={expandedId ? 'Save or cancel editing before refreshing prices.' : undefined}
          disabled={
            refreshing
            || expandedId !== null
            || !holdings.some((holding) => holding.type !== 'cash' && Boolean(holding.symbol.trim()))
          }
          onClick={() => void refreshPrices()}
        >
          <IonIcon icon={refreshOutline} />
          {refreshing ? 'Refreshing prices…' : 'Refresh prices'}
        </button>
      </header>

      <div className="holdingsCoverageStrip" aria-label="Holdings data coverage">
        <span><strong>{coverage.total}</strong> positions</span>
        <span className="complete"><IonIcon icon={checkmarkCircleOutline} /><strong>{coverage.fullyTracked}</strong> fully tracked</span>
        <span><strong>{valueOnlyCount}</strong> value-only</span>
        <span className="coverageMeter">
          <i><b style={{ width: `${Math.round(coverage.fullyTrackedCoverage * 100)}%` }} /></i>
          <small>{Math.round(coverage.fullyTrackedCoverage * 100)}% of portfolio value fully tracked</small>
        </span>
      </div>

      <div className="holdingsToolbar">
        <div className="holdingsFilters" role="group" aria-label="Filter holdings">
          {FILTER_OPTIONS.map(([value, label]) => (
            <button
              type="button"
              className={filter === value ? 'active' : ''}
              aria-pressed={filter === value}
              onClick={() => {
                changeExpanded(null)
                setFilter(value)
              }}
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
        <span>{visibleHoldings.length} shown · {fmt.format(coverage.totalValue)} total</span>
      </div>

      <div className="holdingsNotice" aria-live="polite">
        {notice && <p><IonIcon icon={checkmarkCircleOutline} />{notice}</p>}
        {refreshError && <p className="error" role="alert"><IonIcon icon={warningOutline} />{refreshError}</p>}
      </div>

      <div className="holdingsList">
        <div className="holdingsListHead" aria-hidden="true">
          <span>Position</span><span>Market value</span><span>Gain / loss</span><span>Price</span><span>Updated</span><span />
        </div>
        {visibleHoldings.map(({ holding, index }) => {
          const rowId = holding.id || `legacy-holding-${index}`
          const editorId = `holding-editor-${rowId.replace(/[^a-z0-9_-]/gi, '-')}`
          const expanded = expandedId === rowId
          const gain = holdingGain(holding)
          const gainPct = holdingGainPct(holding)
          return (
            <article className={`holdingRecord ${expanded ? 'expanded' : ''}`} key={rowId}>
              <button
                className="holdingSummaryRow"
                type="button"
                aria-expanded={expanded}
                aria-controls={editorId}
                onClick={() => changeExpanded(expanded ? null : rowId)}
              >
                <span className="holdingIdentity">
                  <span className="holdingAvatar"><IonIcon icon={walletOutline} /></span>
                  <span>
                    <strong>{holding.symbol || '—'}</strong>
                    <small>{holding.name || 'Unnamed position'}</small>
                    <em><i>{sourceLabel(holding.source)}</i><i className={holdingTrackingStatus(holding)}>{statusLabel(holding)}</i></em>
                  </span>
                </span>
                <span className="holdingNumeric">
                  <strong>{fmt.format(holding.value)}</strong>
                  <small>{pct(holding.value / totalValue)} of portfolio</small>
                </span>
                <span className={`holdingNumeric ${gain != null && gain < 0 ? 'negative' : gain != null ? 'positive' : ''}`}>
                  <strong>{gain == null ? '—' : `${gain >= 0 ? '+' : '−'}${fmt.format(Math.abs(gain))}`}</strong>
                  <small>{gainPct == null ? 'Add cost basis' : `${gainPct >= 0 ? '+' : ''}${(gainPct * 100).toFixed(1)}%`}</small>
                </span>
                <span className="holdingNumeric">
                  <strong>{holding.currentPrice == null ? '—' : fmt.format(holding.currentPrice)}</strong>
                  <small>{holding.quantity == null ? 'Value reported' : `${holding.quantity.toLocaleString()} shares`}</small>
                </span>
                <span className="holdingUpdated">
                  <strong>{dateLabel(holding.priceAsOf)}</strong>
                  <small>{holding.priceSource || (holding.currentPrice != null ? 'Manual price' : 'No quote source')}</small>
                </span>
                <IonIcon icon={expanded ? chevronUpOutline : chevronDownOutline} />
              </button>
              {expanded && (
                <div id={editorId}>
                  <HoldingEditor
                    key={rowId}
                    holding={holding}
                    onCancel={() => changeExpanded(null)}
                    onDelete={() => deleteHolding(holding, index)}
                    onSave={(next) => saveHolding(holding, index, next)}
                  />
                </div>
              )}
            </article>
          )
        })}

        {!visibleHoldings.length && (
          <div className="holdingsEmptyState">
            <IonIcon icon={walletOutline} />
            <strong>{holdings.length ? 'No holdings match this filter' : 'No positions yet'}</strong>
            <small>{holdings.length ? 'Choose another filter to see your positions.' : 'Use Add holding above to create your first position.'}</small>
          </div>
        )}
      </div>
    </section>
  )
}
