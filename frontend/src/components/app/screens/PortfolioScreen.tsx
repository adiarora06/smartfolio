// Portfolio workspace — holdings you can edit, with the picture alongside:
// headline metrics, an allocation donut, and per-holding weight bars that all
// recalculate live as you type.

import { useRef, useState, type KeyboardEvent } from 'react'
import { useStore } from '../../../store/useStore'
import { usePortfolioAnalysis } from '../../../hooks/usePortfolioAnalysis'
import { fmt, pct, title } from '../../../lib/format'
import { IonIcon } from '@ionic/react'
import {
  addOutline,
  analyticsOutline,
  alertCircleOutline,
  arrowForwardOutline,
  pieChartOutline,
  pulseOutline,
  refreshOutline,
  shieldCheckmarkOutline,
  timeOutline,
  trendingDownOutline,
  walletOutline,
} from 'ionicons/icons'
import { MetricCard, MetricGrid, Panel, PanelHead } from '../../shared/ui'
import { AppPage } from '../../shared/AppPage'
import { DonutChart, type DonutSegment } from '../../shared/DonutChart'
import { PortfolioFoundation } from './PortfolioFoundation'
import { RebalancePlanner } from './RebalancePlanner'
import { HoldingsWorkspace } from './HoldingsWorkspace'
import '../../../styles/holdings.css'

type PortfolioView = 'snapshot' | 'history' | 'holdings'

const PORTFOLIO_VIEWS: Array<{
  id: PortfolioView
  label: string
  detail: string
  icon: string
}> = [
  { id: 'snapshot', label: 'Snapshot', detail: 'Allocation & risk', icon: pieChartOutline },
  { id: 'history', label: 'History', detail: 'Performance & activity', icon: timeOutline },
  { id: 'holdings', label: 'Holdings', detail: 'Review & edit', icon: walletOutline },
]

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

const STRESS_LABELS = {
  market_selloff: ['Market selloff', 'Broad market -20%'],
  technology_shock: ['Technology shock', 'Technology holdings -25%'],
  rate_shock: ['Rate shock', 'Bonds -8%, rate-sensitive assets lower'],
} as const

function RiskMetric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="portfolioRiskMetric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

export function PortfolioScreen() {
  const holdings = useStore((s) => s.holdings)
  const analysis = usePortfolioAnalysis()
  const addHolding = useStore((s) => s.addHolding)
  const removeHolding = useStore((s) => s.removeHolding)
  const resetHoldings = useStore((s) => s.resetHoldings)
  const openAssistant = useStore((s) => s.openAssistant)
  const [portfolioView, setPortfolioView] = useState<PortfolioView>('snapshot')
  const [editingHoldingId, setEditingHoldingId] = useState<string | null>(null)
  const [newHoldingId, setNewHoldingId] = useState<string | null>(null)
  const viewTabs = useRef<Array<HTMLButtonElement | null>>([])

  const selectPortfolioView = (view: PortfolioView, focus = false) => {
    const index = PORTFOLIO_VIEWS.findIndex((item) => item.id === view)
    if (view !== 'holdings' && newHoldingId && editingHoldingId === newHoldingId) {
      removeHolding(newHoldingId)
      setNewHoldingId(null)
      setEditingHoldingId(null)
    }
    setPortfolioView(view)
    if (focus) requestAnimationFrame(() => viewTabs.current[index]?.focus())
  }

  const handleViewKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % PORTFOLIO_VIEWS.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + PORTFOLIO_VIEWS.length) % PORTFOLIO_VIEWS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = PORTFOLIO_VIEWS.length - 1
    if (nextIndex == null) return
    event.preventDefault()
    selectPortfolioView(PORTFOLIO_VIEWS[nextIndex].id, true)
  }

  const addAndEditHolding = () => {
    if (newHoldingId) removeHolding(newHoldingId)
    const holdingId = addHolding()
    setNewHoldingId(holdingId)
    setEditingHoldingId(holdingId)
    selectPortfolioView('holdings')
  }

  const resetPortfolio = () => {
    resetHoldings()
    setNewHoldingId(null)
    setEditingHoldingId(null)
  }

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
  const risk = analysis.risk
  const riskBudgetStatus =
    risk.riskBudgetUsed > 1
      ? 'Above profile budget'
      : risk.riskBudgetUsed > 0.85
        ? 'Near profile budget'
        : 'Inside profile budget'
  const topRiskDriver = risk.topContributors[0]
  const openRiskAssistant = () => {
    const topDriverSummary = topRiskDriver
      ? `${topRiskDriver.label} contributes ${pct(topRiskDriver.riskContribution)} of modeled risk at ${pct(topRiskDriver.weight)} of capital`
      : 'No individual holding is a material modeled risk driver'
    openAssistant({
      origin: 'portfolio',
      kind: 'risk_driver',
      title: 'Portfolio risk model',
      summary: `Annualized volatility is ${pct(risk.annualizedVolatility)} and ${pct(risk.riskBudgetUsed)} of the profile budget is in use. ${topDriverSummary}.`,
      suggestedQuestion: `Explain my largest modeled risk driver and show how I could lower risk without abandoning my ${title(analysis.riskProfileName)} target.`,
      facts: {
        'Annual volatility': pct(risk.annualizedVolatility),
        'Risk budget': `${pct(risk.riskBudgetUsed)} used`,
        'Top risk driver': topRiskDriver?.label ?? 'No material driver',
        '1-month VaR 95%': pct(risk.var95OneMonth),
      },
    })
  }

  return (
    <AppPage
      title="Portfolio"
      subtitle="Allocation, estimated performance, and risk — one focused view at a time."
      actions={
        <>
          <button className="primary" onClick={addAndEditHolding}>
            <IonIcon icon={addOutline} />
            Add holding
          </button>
          <button onClick={resetPortfolio}>
            <IonIcon icon={refreshOutline} />
            Reset demo
          </button>
        </>
      }
    >
      <div className="portfolioScreen">
      <nav className="portfolioWorkspaceTabs" role="tablist" aria-label="Portfolio workspace views">
        {PORTFOLIO_VIEWS.map((item, index) => (
          <button
            ref={(element) => { viewTabs.current[index] = element }}
            id={`portfolio-${item.id}-tab`}
            className={`portfolioWorkspaceTab ${item.id === 'history' ? 'history' : ''} ${portfolioView === item.id ? 'active' : ''}`}
            role="tab"
            aria-selected={portfolioView === item.id}
            aria-controls={`portfolio-${item.id}-panel`}
            tabIndex={portfolioView === item.id ? 0 : -1}
            onClick={() => selectPortfolioView(item.id)}
            onKeyDown={(event) => handleViewKeyDown(event, index)}
            key={item.id}
          >
            <IonIcon icon={item.icon} />
            <span>
              <strong>{item.label}</strong>
              <small>{item.id === 'holdings' ? `${holdings.length} positions · edit` : item.detail}</small>
            </span>
          </button>
        ))}
      </nav>

      {portfolioView === 'snapshot' && (
      <div
        className="portfolioWorkspacePanel portfolioSnapshotView"
        id="portfolio-snapshot-panel"
        role="tabpanel"
        aria-labelledby="portfolio-snapshot-tab"
        tabIndex={0}
      >
      <div className="portfolioSummaryBand">
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
      </div>

      <div className="portfolioCoreGrid">
      <Panel className="portfolioAllocationPanel">
        <PanelHead title="Allocation at a glance" />
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
            {weights.map((h, index) => (
              <div className="wrow" key={`${h.symbol}-${index}`}>
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

      <RebalancePlanner analysis={analysis} />
      </div>

      <section className="portfolioRiskLab" aria-labelledby="portfolio-risk-title">
        <header className="portfolioRiskHead">
          <div className="portfolioRiskTitle">
            <span><IonIcon icon={analyticsOutline} /></span>
            <div>
              <small>Deterministic portfolio model</small>
              <h2 id="portfolio-risk-title">Risk lab</h2>
              <p>See which positions carry risk, not just capital, and replay three explicit shocks.</p>
            </div>
          </div>
          <div className={`portfolioRiskBudget ${risk.riskBudgetUsed > 1 ? 'over' : ''}`}>
            <IonIcon icon={risk.riskBudgetUsed > 1 ? alertCircleOutline : shieldCheckmarkOutline} />
            <span>
              <small>{riskBudgetStatus}</small>
              <strong>{pct(risk.riskBudgetUsed)} used</strong>
            </span>
          </div>
        </header>

        <div className="portfolioRiskMetrics">
          <RiskMetric
            label="Annual volatility"
            value={pct(risk.annualizedVolatility)}
            detail={`target mix ${pct(risk.targetVolatility)}`}
          />
          <RiskMetric
            label="Portfolio beta"
            value={risk.beta.toFixed(2)}
            detail={`${pct(risk.systematicShare)} systematic risk`}
          />
          <RiskMetric
            label="Effective positions"
            value={risk.effectivePositions.toFixed(1)}
            detail={`${holdings.length} holdings by count`}
          />
          <RiskMetric
            label="1-month VaR 95%"
            value={pct(risk.var95OneMonth)}
            detail={`${fmt.format(analysis.value * risk.var95OneMonth)} modeled threshold`}
          />
          <RiskMetric
            label="Tail loss 95%"
            value={pct(risk.cvar95OneMonth)}
            detail="average beyond VaR"
          />
          <RiskMetric
            label="Return / risk"
            value={risk.returnToRisk.toFixed(2)}
            detail={`${risk.diversificationRatio.toFixed(2)}× diversification ratio`}
          />
        </div>

        <div className="portfolioRiskDetails">
          <div className="portfolioContributionPanel">
            <div className="portfolioRiskSubhead">
              <span><IonIcon icon={pulseOutline} /></span>
              <div>
                <h3>Risk contribution</h3>
                <p>Teal is capital weight. Indigo is modeled share of total volatility.</p>
              </div>
            </div>
            <div className="portfolioContributionList">
              {risk.topContributors.map((item, index) => (
                <div className="portfolioContributionRow" key={`${item.label}-${index}`}>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.beta.toFixed(2)} beta · {pct(item.volatility)} volatility</small>
                  </div>
                  <div className="portfolioContributionBars" aria-label={`${item.label}: ${pct(item.weight)} capital and ${pct(item.riskContribution)} risk`}>
                    <span className="capital" style={{ width: `${Math.min(item.weight * 100, 100)}%` }} />
                    <span className="risk" style={{ width: `${Math.min(item.riskContribution * 100, 100)}%` }} />
                  </div>
                  <div className="portfolioContributionValues">
                    <span>{pct(item.weight)}</span>
                    <strong>{pct(item.riskContribution)}</strong>
                  </div>
                </div>
              ))}
              {!risk.topContributors.length && (
                <p className="portfolioRiskEmpty">Add a funded holding to calculate risk contribution.</p>
              )}
            </div>
          </div>

          <div className="portfolioStressPanel">
            <div className="portfolioRiskSubhead">
              <span><IonIcon icon={trendingDownOutline} /></span>
              <div>
                <h3>Stress replay</h3>
                <p>Illustrative shocks using the same asset and sector assumptions.</p>
              </div>
            </div>
            <div className="portfolioStressList">
              {risk.stressTests.map((stress) => {
                const [label, assumption] = STRESS_LABELS[stress.scenario]
                return (
                  <div key={stress.scenario}>
                    <span>
                      <strong>{label}</strong>
                      <small>{assumption}</small>
                    </span>
                    <span>
                      <strong>{pct(stress.estimatedReturn)}</strong>
                      <small>{fmt.format(stress.dollarImpact)}</small>
                    </span>
                  </div>
                )
              })}
            </div>
            <button onClick={openRiskAssistant}>
              Model a strategy with AI
              <IonIcon icon={arrowForwardOutline} />
            </button>
          </div>
        </div>

        <footer className="portfolioRiskFoot">
          Assumption-driven estimates for education—not forecasts or guarantees. Live market histories will replace assumptions in a later calibration pass.
        </footer>
      </section>
      </div>
      )}

      {portfolioView === 'history' && (
        <div
          className="portfolioWorkspacePanel portfolioHistoryView"
          id="portfolio-history-panel"
          role="tabpanel"
          aria-labelledby="portfolio-history-tab"
          tabIndex={0}
        >
          <PortfolioFoundation currentValue={analysis.value} />
        </div>
      )}

      {portfolioView === 'holdings' && (
        <div
          className="portfolioWorkspacePanel portfolioHoldingsView"
          id="portfolio-holdings-panel"
          role="tabpanel"
          aria-labelledby="portfolio-holdings-tab"
          tabIndex={0}
        >
          <HoldingsWorkspace
            expandedId={editingHoldingId}
            onExpandedIdChange={setEditingHoldingId}
            draftId={newHoldingId}
            onDraftResolved={() => setNewHoldingId(null)}
          />
        </div>
      )}
      </div>
    </AppPage>
  )
}
