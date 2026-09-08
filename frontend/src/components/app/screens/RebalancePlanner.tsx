import { useMemo, useState } from 'react'
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonModal,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/react'
import {
  arrowForwardOutline,
  arrowUndoOutline,
  cashOutline,
  checkmarkCircleOutline,
  closeOutline,
  informationCircleOutline,
  optionsOutline,
  refreshOutline,
  shieldCheckmarkOutline,
  sparklesOutline,
  swapHorizontalOutline,
  warningOutline,
} from 'ionicons/icons'
import type { Holding } from '../../../types'
import type { PortfolioAnalysis } from '../../../lib/calculations/portfolio'
import {
  apiPreviewRebalance,
  type RebalanceMode,
  type RebalancePreview,
  type RebalanceTrade,
} from '../../../lib/api/client'
import {
  allocationDrift,
  exactProjectedHoldings,
  rebalanceApplyBlocker,
  rebalanceInputSignature,
} from '../../../lib/rebalance'
import { fmt, pct, title } from '../../../lib/format'
import { useStore } from '../../../store/useStore'

const ASSET_ORDER = ['us_equity', 'intl_equity', 'bonds', 'cash', 'alternatives', 'crypto', 'other']

const assetLabel = (asset: string) =>
  asset === 'us_equity' ? 'US Equity' : asset === 'intl_equity' ? 'Intl Equity' : title(asset)

const amountValue = (value: string, fallback = 0) => {
  const parsed = Number(value.replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback
}

function TradeRow({ trade }: { trade: RebalanceTrade }) {
  const unresolved = !trade.resolved || !trade.symbol
  return (
    <div className={`rebalanceTradeRow ${unresolved ? 'unresolved' : ''}`}>
      <span className={`rebalanceTradeAction ${trade.action}`}>
        {trade.action === 'buy' ? 'Buy' : 'Sell'}
      </span>
      <span className="rebalanceTradeIdentity">
        <strong>{unresolved ? 'Choose investment' : trade.symbol}</strong>
        <small>{unresolved ? assetLabel(trade.asset) : trade.name || assetLabel(trade.asset)}</small>
      </span>
      <span className="rebalanceTradeValues">
        <strong>{fmt.format(trade.amount)}</strong>
        {trade.beforeValue != null && trade.afterValue != null && (
          <small>{fmt.format(trade.beforeValue)} → {fmt.format(trade.afterValue)}</small>
        )}
      </span>
    </div>
  )
}

function AllocationPreview({ preview }: { preview: RebalancePreview }) {
  const assets = [...new Set([
    ...Object.keys(preview.beforeAllocation),
    ...Object.keys(preview.afterAllocation),
    ...Object.keys(preview.targetAllocation),
  ])]
    .filter((asset) => (preview.beforeAllocation[asset] ?? 0) > 0.001 || (preview.targetAllocation[asset] ?? 0) > 0.001)
    .sort((a, b) => {
      const knownOrder = ASSET_ORDER.indexOf(a) - ASSET_ORDER.indexOf(b)
      return knownOrder || (preview.targetAllocation[b] ?? 0) - (preview.targetAllocation[a] ?? 0)
    })

  return (
    <div className="rebalanceAllocationList">
      <div className="rebalanceAllocationLegend" aria-hidden="true">
        <span><i className="before" />Before</span>
        <span><i className="after" />After</span>
        <span><i className="target" />Target</span>
      </div>
      {assets.map((asset) => {
        const before = preview.beforeAllocation[asset] ?? 0
        const after = preview.afterAllocation[asset] ?? 0
        const target = preview.targetAllocation[asset] ?? 0
        return (
          <div className="rebalanceAllocationRow" key={asset}>
            <div className="rebalanceAllocationCopy">
              <strong>{assetLabel(asset)}</strong>
              <span>{pct(before)} → <b>{pct(after)}</b></span>
            </div>
            <div
              className="rebalanceAllocationBars"
              aria-label={`${assetLabel(asset)}: ${pct(before)} before, ${pct(after)} after, ${pct(target)} target`}
            >
              <span className="before" style={{ width: `${Math.min(before * 100, 100)}%` }} />
              <span className="after" style={{ width: `${Math.min(after * 100, 100)}%` }} />
              <i className="target" style={{ left: `${Math.min(target * 100, 100)}%` }} />
            </div>
            <strong className="rebalanceAllocationTarget">{pct(target)}</strong>
          </div>
        )
      })}
    </div>
  )
}

export function RebalancePlanner({ analysis }: { analysis: PortfolioAnalysis }) {
  const holdings = useStore((state) => state.holdings)
  const profile = useStore((state) => state.profile)
  const backendOnline = useStore((state) => state.backendOnline)
  const replaceHoldings = useStore((state) => state.replaceHoldings)
  const openAssistant = useStore((state) => state.openAssistant)

  const [mode, setMode] = useState<RebalanceMode>('new_money_only')
  const [contributionAmount, setContributionAmount] = useState(Math.max(profile.contribution, 0))
  const [minTradeAmount, setMinTradeAmount] = useState(100)
  const [previewState, setPreviewState] = useState<{
    preview: RebalancePreview
    signature: string
  } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [undoSnapshot, setUndoSnapshot] = useState<Holding[] | null>(null)
  const [applied, setApplied] = useState(false)

  const effectiveContribution = mode === 'new_money_only' ? contributionAmount : 0
  const currentSignature = useMemo(
    () => `${rebalanceInputSignature(holdings, mode, effectiveContribution, minTradeAmount)}::${JSON.stringify(profile)}`,
    [effectiveContribution, holdings, minTradeAmount, mode, profile],
  )
  const preview = previewState?.preview ?? null
  const stale = Boolean(previewState && previewState.signature !== currentSignature && !applied)
  const applyBlocker = preview ? rebalanceApplyBlocker(holdings, preview) : null
  const unresolvedCount = preview?.trades.filter((trade) => !trade.resolved || !trade.symbol).length ?? 0
  const planningNotes = preview?.warnings.filter(
    (warning) => warning.code !== 'unresolved_buy_target' && warning.code !== 'target_not_reached',
  ) ?? []
  const driftBefore = preview
    ? allocationDrift(preview.beforeAllocation, preview.targetAllocation)
    : allocationDrift(analysis.current, analysis.target)
  const driftAfter = preview
    ? allocationDrift(preview.afterAllocation, preview.targetAllocation)
    : driftBefore

  const runPreview = async () => {
    setPending(true)
    setError(null)
    setApplied(false)
    setConfirming(false)
    try {
      const result = await apiPreviewRebalance({
        profile,
        holdings,
        mode,
        contributionAmount: effectiveContribution,
        minTradeAmount,
      })
      setPreviewState({ preview: result, signature: currentSignature })
      setReviewOpen(true)
    } catch {
      setError(
        backendOnline === false
          ? 'The rebalancing engine is offline. Your holdings were not changed.'
          : 'The planner could not build a preview. Try again when the engine is available.',
      )
    } finally {
      setPending(false)
    }
  }

  const applyPreview = () => {
    if (!preview || stale || applied) return
    try {
      const next = exactProjectedHoldings(holdings, preview)
      setUndoSnapshot(holdings.map((holding) => ({ ...holding })))
      replaceHoldings(next)
      setApplied(true)
      setConfirming(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This plan cannot be applied safely.')
    }
  }

  const undoApply = () => {
    if (!undoSnapshot) return
    replaceHoldings(undoSnapshot)
    setUndoSnapshot(null)
    setApplied(false)
  }

  const askAssistant = () => {
    if (!preview) return
    const topTrades = preview.trades
      .slice(0, 4)
      .map((trade) => `${trade.action} ${fmt.format(trade.amount)} of ${trade.symbol || assetLabel(trade.asset)}`)
      .join('; ')
    openAssistant({
      origin: 'portfolio',
      kind: 'rebalance_plan',
      title: mode === 'new_money_only' ? 'Contribution-first rebalance' : 'Full portfolio rebalance',
      summary: `${preview.trades.length} modeled trades move ${fmt.format(preview.totalTraded)}. Allocation drift changes from ${pct(driftBefore)} to ${pct(driftAfter)}.`,
      suggestedQuestion: `Explain the trade-offs in this modeled rebalance plan: ${topTrades}. Do not assume any brokerage orders were placed.`,
      facts: {
        Mode: mode === 'new_money_only' ? 'New money only' : 'Full rebalance',
        'Amount modeled': fmt.format(preview.totalTraded),
        'Drift before': pct(driftBefore),
        'Drift after': pct(driftAfter),
      },
    })
  }

  return (
    <>
      <aside className="portfolioPlannerCard" aria-labelledby="rebalance-planner-title">
        <header className="portfolioPlannerHead">
          <span><IonIcon icon={sparklesOutline} /></span>
          <div>
            <small>Decision tool</small>
            <h2 id="rebalance-planner-title">Rebalancing planner</h2>
          </div>
          <span className={`plannerEngineStatus ${backendOnline === false ? 'offline' : ''}`}>
            {backendOnline === false ? 'Offline' : 'Python model'}
          </span>
        </header>

        <div className="portfolioPlannerBody">
          <div className="plannerModePicker" aria-label="Rebalancing mode">
            <button
              className={mode === 'new_money_only' ? 'active' : ''}
              aria-pressed={mode === 'new_money_only'}
              onClick={() => setMode('new_money_only')}
            >
              <IonIcon icon={cashOutline} />
              New money
            </button>
            <button
              className={mode === 'rebalance' ? 'active' : ''}
              aria-pressed={mode === 'rebalance'}
              onClick={() => setMode('rebalance')}
            >
              <IonIcon icon={swapHorizontalOutline} />
              Full rebalance
            </button>
          </div>

          <div className="plannerInputGrid">
            <label>
              <span>Contribution amount</span>
              <span className="plannerMoneyInput">
                <b>$</b>
                <input
                  aria-label="Contribution amount"
                  type="number"
                  min="0"
                  step="100"
                  value={effectiveContribution}
                  disabled={mode === 'rebalance'}
                  onChange={(event) => setContributionAmount(amountValue(event.target.value))}
                />
              </span>
            </label>
            <label>
              <span>Minimum trade</span>
              <span className="plannerMoneyInput">
                <b>$</b>
                <input
                  aria-label="Minimum trade amount"
                  type="number"
                  min="0"
                  step="25"
                  value={minTradeAmount}
                  onChange={(event) => setMinTradeAmount(amountValue(event.target.value))}
                />
              </span>
            </label>
          </div>

          <p className="plannerModeNote">
            <IonIcon icon={mode === 'new_money_only' ? shieldCheckmarkOutline : informationCircleOutline} />
            {mode === 'new_money_only'
              ? 'Directs new cash toward gaps without selling current positions.'
              : 'May include sales. Taxes, spreads, and account rules are not modeled.'}
          </p>

          {error && (
            <div className="plannerInlineNotice error" role="alert">
              <IonIcon icon={warningOutline} />
              <span>{error}</span>
            </div>
          )}

          {applied && (
            <div className="plannerInlineNotice success" role="status">
              <IonIcon icon={checkmarkCircleOutline} />
              <span>Applied to your SmartFolio model.</span>
              <button onClick={undoApply}>Undo</button>
            </div>
          )}

          {preview && !applied && (
            <button className="plannerPreviewSummary" onClick={() => setReviewOpen(true)}>
              <span>
                <small>{stale ? 'Inputs changed' : `${preview.trades.length} proposed trades`}</small>
                <strong>{stale ? 'Refresh to review' : `${fmt.format(preview.totalTraded)} modeled`}</strong>
              </span>
              <span>
                <small>Target drift</small>
                <strong>{pct(driftBefore)} → {pct(driftAfter)}</strong>
              </span>
              <IonIcon icon={arrowForwardOutline} />
            </button>
          )}
        </div>

        <button className="portfolioStrategyButton plannerRunButton" onClick={runPreview} disabled={pending}>
          <span>{pending ? 'Building exact plan…' : preview ? 'Refresh and review plan' : 'Build and review plan'}</span>
          {pending ? <IonSpinner name="crescent" /> : <IonIcon icon={preview ? refreshOutline : arrowForwardOutline} />}
        </button>
      </aside>

      <IonModal
        isOpen={reviewOpen && Boolean(preview)}
        onDidDismiss={() => {
          setReviewOpen(false)
          setConfirming(false)
        }}
        className="rebalanceReviewModal"
      >
        <IonHeader>
          <IonToolbar>
            <IonTitle>Review rebalancing plan</IonTitle>
            <IonButtons slot="end">
              <IonButton aria-label="Close rebalancing plan" onClick={() => setReviewOpen(false)}>
                <IonIcon slot="icon-only" icon={closeOutline} />
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent>
          {preview && (
            <div className="rebalanceReview">
              <header className="rebalanceReviewHero">
                <div>
                  <span className="rebalanceReviewEyebrow">
                    <IonIcon icon={optionsOutline} />
                    {mode === 'new_money_only' ? 'Contribution-first plan' : 'Full rebalance'}
                  </span>
                  <h2>{preview.trades.length ? 'A clearer path toward your target' : 'Your portfolio is already within the guardrails'}</h2>
                  <p>Review every modeled change before updating SmartFolio. No brokerage orders are placed.</p>
                </div>
                <span className="rebalanceProfileBadge">{title(analysis.riskProfileName)} target</span>
              </header>

              {applied && (
                <div className="rebalanceReviewNotice success" role="status">
                  <IonIcon icon={checkmarkCircleOutline} />
                  <span>
                    <strong>Plan applied to your portfolio model</strong>
                    <small>Your SmartFolio holdings now use the exact projected values below.</small>
                  </span>
                  <button onClick={undoApply}><IonIcon icon={arrowUndoOutline} /> Undo</button>
                </div>
              )}

              {stale && (
                <div className="rebalanceReviewNotice warning" role="alert">
                  <IonIcon icon={warningOutline} />
                  <span>
                    <strong>This preview is out of date</strong>
                    <small>Holdings or planner inputs changed. Close this view and refresh the plan.</small>
                  </span>
                </div>
              )}

              {!stale && unresolvedCount > 0 && (
                <div className="rebalanceReviewNotice warning" role="status">
                  <IonIcon icon={warningOutline} />
                  <span>
                    <strong>{unresolvedCount} {unresolvedCount === 1 ? 'trade needs' : 'trades need'} an investment</strong>
                    <small>SmartFolio identified the asset-class gap but will not invent a security for you.</small>
                  </span>
                </div>
              )}

              {planningNotes.length > 0 && (
                <details className="rebalancePlanningNotes">
                  <summary>
                    <IonIcon icon={informationCircleOutline} />
                    <span>
                      <strong>{planningNotes.length} planning {planningNotes.length === 1 ? 'note' : 'notes'}</strong>
                      <small>Minimum-trade constraints and remaining target gaps</small>
                    </span>
                    <IonIcon icon={arrowForwardOutline} />
                  </summary>
                  <div>
                    {planningNotes.map((warning) => (
                      <p key={`${warning.code}-${warning.asset || ''}-${warning.message}`}>
                        {warning.message}
                      </p>
                    ))}
                  </div>
                </details>
              )}

              <div className="rebalanceMetricStrip">
                <div><span>Portfolio before</span><strong>{fmt.format(preview.beforeTotal)}</strong><small>{holdings.length} holdings</small></div>
                <div><span>Portfolio after</span><strong>{fmt.format(preview.afterTotal)}</strong><small>{mode === 'new_money_only' ? `+${fmt.format(effectiveContribution)} contribution` : 'same invested value'}</small></div>
                <div><span>Amount modeled</span><strong>{fmt.format(preview.totalTraded)}</strong><small>{preview.trades.length} trades above minimum</small></div>
                <div><span>Target drift</span><strong>{pct(driftAfter)}</strong><small>from {pct(driftBefore)} before</small></div>
              </div>

              <div className="rebalanceReviewGrid">
                <section className="rebalanceReviewPanel" aria-labelledby="rebalance-allocation-title">
                  <header>
                    <div>
                      <span>Before and after</span>
                      <h3 id="rebalance-allocation-title">Allocation preview</h3>
                    </div>
                    <small>Target marker</small>
                  </header>
                  <AllocationPreview preview={preview} />
                </section>

                <section className="rebalanceReviewPanel" aria-labelledby="rebalance-trades-title">
                  <header>
                    <div>
                      <span>Exact model changes</span>
                      <h3 id="rebalance-trades-title">Trade list</h3>
                    </div>
                    <small>{fmt.format(minTradeAmount)} minimum</small>
                  </header>
                  <div className="rebalanceTradeList">
                    {preview.trades.map((trade, index) => (
                      <TradeRow trade={trade} key={`${trade.action}-${trade.symbol || trade.asset}-${index}`} />
                    ))}
                    {!preview.trades.length && (
                      <div className="rebalanceEmptyTrades">
                        <IonIcon icon={checkmarkCircleOutline} />
                        <strong>No trades are needed</strong>
                        <small>Your allocation is within the selected minimum-trade guardrail.</small>
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <footer className="rebalanceReviewFooter">
                <p><IonIcon icon={shieldCheckmarkOutline} /> Preview only—SmartFolio cannot place brokerage orders.</p>
                {confirming ? (
                  <div className="rebalanceConfirmBar" role="alertdialog" aria-label="Confirm portfolio model update">
                    <span>
                      <strong>Apply these modeled values?</strong>
                      <small>You can undo this change with one click.</small>
                    </span>
                    <button onClick={() => setConfirming(false)}>Cancel</button>
                    <button className="primary" onClick={applyPreview}>Confirm update</button>
                  </div>
                ) : (
                  <div className="rebalanceReviewActions">
                    <button onClick={askAssistant}>Ask AI about this plan</button>
                    <button
                      className="primary"
                      disabled={Boolean(applyBlocker) || stale || applied || !preview.trades.length}
                      title={applyBlocker || (stale ? 'Refresh this preview before applying it.' : undefined)}
                      onClick={() => setConfirming(true)}
                    >
                      {applied ? 'Applied to SmartFolio' : applyBlocker ? 'Resolve investments first' : 'Apply to portfolio model'}
                    </button>
                  </div>
                )}
              </footer>
            </div>
          )}
        </IonContent>
      </IonModal>
    </>
  )
}
