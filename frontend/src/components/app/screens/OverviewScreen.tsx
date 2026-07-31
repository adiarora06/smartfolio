// Mobile-first portfolio overview with a deterministic fit score and modeled path.

import { IonButton, IonIcon } from '@ionic/react'
import {
  chevronForwardOutline,
  personCircleOutline,
  pieChartOutline,
  shieldCheckmarkOutline,
  sparklesOutline,
  trendingUpOutline,
} from 'ionicons/icons'
import { useStore } from '../../../store/useStore'
import { usePortfolioAnalysis } from '../../../hooks/usePortfolioAnalysis'
import { calculateFolioFit, selectSmartMove } from '../../../lib/calculations/overview'
import { fmt, pct, title } from '../../../lib/format'
import { MetricCard, MetricGrid, Panel, PanelHead } from '../../shared/ui'
import { AppPage } from '../../shared/AppPage'
import { AllocationBars } from '../../shared/AllocationBars'
import { InsightList, type InsightItem } from '../../shared/InsightList'
import { FolioPathChart } from '../../shared/FolioPathChart'

function assetName(asset: string): string {
  return title(asset).replace(/^Us /, 'US ').replace(/^Intl /, 'International ')
}

function moveDetail(asset: string): string {
  if (asset === 'bonds') return 'Adds stability while preserving your growth posture.'
  if (asset === 'intl_equity') return 'Reduces reliance on US markets while keeping equity exposure.'
  if (asset === 'alternatives') return 'Adds another return source to the portfolio mix.'
  return 'Closes your largest allocation gap at a measured pace.'
}

export function OverviewScreen() {
  const analysis = usePortfolioAnalysis()
  const holdings = useStore((s) => s.holdings)
  const stock = useStore((s) => s.stock)
  const setScreen = useStore((s) => s.setScreen)
  const checkBackend = useStore((s) => s.checkBackend)

  const refresh = async () => {
    await checkBackend()
  }

  const insightItems: InsightItem[] = [
    ...analysis.concentrations.map((finding) => ({
      stat: pct(finding.weight),
      text:
        finding.kind === 'single_stock'
          ? `${finding.label} — single stock`
          : finding.kind === 'stock_aggregate'
            ? 'in individual stocks'
            : `${title(finding.label)} sector`,
      warn: true,
    })),
    ...analysis.recommendations.slice(0, 3).map((signal) => ({
      text:
        signal.kind === 'increase'
          ? `Add ${title(signal.asset ?? '')}`
          : signal.kind === 'reduce'
            ? `Trim ${title(signal.asset ?? '')}`
            : 'Shift into broad funds over time',
    })),
  ]
  if (!analysis.concentrations.length) {
    insightItems.unshift({ stat: '0', text: 'concentration flags — well diversified' })
  }

  const fit = calculateFolioFit(analysis.gap, analysis.concentrations.length)
  const smartMove = selectSmartMove(analysis.gap)
  const largestOverweight = Object.entries(analysis.gap)
    .filter(([, delta]) => delta < -0.02)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]
  const fitLabel = fit >= 85 ? 'Strong fit' : fit >= 70 ? 'Good fit' : 'Needs review'

  return (
    <AppPage
      title="SmartFolio"
      largeTitle={false}
      onRefresh={refresh}
      headerAction={
        <IonButton routerLink="/more" fill="clear" aria-label="Open profile and more">
          <IonIcon slot="icon-only" icon={personCircleOutline} />
        </IonButton>
      }
    >
      <div className="nativeOverview">
        <section className="folioSummary" aria-labelledby="portfolio-value-label">
          <span id="portfolio-value-label">Total portfolio value</span>
          <strong>{fmt.format(analysis.value)}</strong>
          <div className="folioReturn">
            <IonIcon icon={trendingUpOutline} aria-hidden="true" />
            <b>{pct(analysis.currentReturn)}</b>
            <span>expected over 1 year</span>
          </div>
        </section>

        <section className="folioPathCard">
          <FolioPathChart
            currentReturn={analysis.currentReturn}
            targetReturn={analysis.targetReturn}
          />
        </section>

        <section className="folioHealth" aria-labelledby="folio-fit-title">
          <div className="folioFitVisual">
            <h2 id="folio-fit-title">Folio Fit</h2>
            <svg viewBox="0 0 104 104" role="img" aria-label={`Folio Fit ${fit} out of 100, ${fitLabel}`}>
              <circle className="folioFitTrack" cx="52" cy="52" r="43" pathLength="100" />
              <circle
                className="folioFitProgress"
                cx="52"
                cy="52"
                r="43"
                pathLength="100"
                strokeDasharray={`${fit} ${100 - fit}`}
              />
              <text x="52" y="53" textAnchor="middle" className="folioFitNumber">{fit}</text>
              <text x="52" y="70" textAnchor="middle" className="folioFitLabel">{fitLabel}</text>
            </svg>
          </div>

          <div className="folioHealthRows">
            <button type="button" onClick={() => setScreen('portfolio')}>
              <IonIcon icon={shieldCheckmarkOutline} aria-hidden="true" />
              <span><b>Risk: {title(analysis.riskProfileName)}</b><small>On target</small></span>
              <IonIcon icon={chevronForwardOutline} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setScreen('portfolio')}>
              <IonIcon className="warn" icon={pieChartOutline} aria-hidden="true" />
              <span><b>Diversification</b><small>{analysis.concentrations.length ? 'Needs attention' : 'On target'}</small></span>
              <IonIcon icon={chevronForwardOutline} aria-hidden="true" />
            </button>
          </div>
        </section>

        {smartMove && (
          <button className="smartMove" type="button" onClick={() => setScreen('advisor')}>
            <span className="smartMoveIcon"><IonIcon icon={sparklesOutline} aria-hidden="true" /></span>
            <span className="smartMoveCopy">
              <span className="smartMoveLabel">Smart Move <em>AI-supported</em></span>
              <strong>Increase {assetName(smartMove.asset)} by {pct(smartMove.delta, 0)}</strong>
              <small>{moveDetail(smartMove.asset)}</small>
            </span>
            <IonIcon icon={chevronForwardOutline} aria-hidden="true" />
          </button>
        )}

        <button className="reviewPlan" type="button" onClick={() => setScreen('portfolio')}>
          Review my plan
          <IonIcon icon={chevronForwardOutline} aria-hidden="true" />
        </button>

        {largestOverweight && (
          <button className="folioAlertRow" type="button" onClick={() => setScreen('portfolio')}>
            <span><IonIcon icon={pieChartOutline} aria-hidden="true" /></span>
            <span>
              <strong>{assetName(largestOverweight[0])} is {pct(Math.abs(largestOverweight[1]), 0)} above target</strong>
              <small>Review a gradual rebalance to reduce concentration.</small>
            </span>
            <IonIcon icon={chevronForwardOutline} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="desktopOverview">
        <div className="pageIntro">
          <p className="pageSubtitle">Your portfolio at a glance — value, risk, allocation, next actions.</p>
          <div className="pageActions">
            <button onClick={() => setScreen('stock')}>Analyze Stock</button>
            <button className="primary" onClick={() => setScreen('connections')}>Connect Apps</button>
          </div>
        </div>

        <MetricGrid>
          <MetricCard label="Portfolio Value" value={fmt.format(analysis.value)} sub={`${holdings.length} holdings`} />
          <MetricCard label="Risk Profile" value={title(analysis.riskProfileName)} sub={`Score ${analysis.riskScore.toFixed(4)}`} />
          <MetricCard label="Current 1Y" value={pct(analysis.currentReturn)} sub={`Target ${pct(analysis.targetReturn)}`} />
          <MetricCard label="Analyze Stock" value={stock.symbol} sub={stock.rating} />
        </MetricGrid>

        <div className="grid2">
          <Panel>
            <PanelHead title="Target Allocation" subtitle="Now vs your risk target." />
            <div className="body"><AllocationBars analysis={analysis} /></div>
          </Panel>
          <Panel>
            <PanelHead title="AI Insight Queue" subtitle="What needs attention first." />
            <div className="body"><InsightList items={insightItems} /></div>
          </Panel>
        </div>
      </div>
    </AppPage>
  )
}
