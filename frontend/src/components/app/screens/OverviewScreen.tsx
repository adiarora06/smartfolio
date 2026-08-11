// Mobile-first portfolio overview with a deterministic fit score and modeled path.

import { IonButton, IonIcon } from '@ionic/react'
import {
  alertCircleOutline,
  arrowForwardOutline,
  chevronForwardOutline,
  compassOutline,
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
import { AppPage } from '../../shared/AppPage'
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
  const stock = useStore((s) => s.stock)
  const setScreen = useStore((s) => s.setScreen)
  const openAssistant = useStore((s) => s.openAssistant)
  const checkBackend = useStore((s) => s.checkBackend)

  const refresh = async () => {
    await checkBackend()
  }

  const fit = calculateFolioFit(analysis.gap, analysis.concentrations.length)
  const smartMove = selectSmartMove(analysis.gap)
  const largestOverweight = Object.entries(analysis.gap)
    .filter(([, delta]) => delta < -0.02)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]
  const fitLabel = fit >= 85 ? 'Strong fit' : fit >= 70 ? 'Good fit' : 'Needs review'
  const gapMoves = Object.entries(analysis.gap)
    .filter(([, delta]) => Math.abs(delta) >= 0.02)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 4)
  const topConcern = analysis.concentrations[0]

  const openAllocationAssistant = () => {
    if (!smartMove) {
      setScreen('scenarios')
      return
    }
    const current = analysis.current[smartMove.asset] ?? 0
    const target = analysis.target[smartMove.asset] ?? 0
    const asset = assetName(smartMove.asset)
    openAssistant({
      origin: 'overview',
      kind: 'allocation_gap',
      title: `${asset} allocation gap`,
      summary: `${asset} is ${pct(current)} of the portfolio versus a ${pct(target)} target, a ${pct(smartMove.delta)} gap for the ${title(analysis.riskProfileName)} profile.`,
      suggestedQuestion: `How can I rebalance gradually to close my ${pct(smartMove.delta)} ${asset} gap, and what trade-offs should I consider without assuming higher returns?`,
      facts: {
        Current: pct(current),
        Target: pct(target),
        Gap: pct(smartMove.delta),
        'Risk profile': title(analysis.riskProfileName),
      },
    })
  }

  return (
    <AppPage
      title="Overview"
      subtitle="Portfolio health, trajectory, and the next decisions worth making."
      actions={
        <>
          <button onClick={() => setScreen('stock')}>Analyze stock</button>
          <button className="primary" onClick={openAllocationAssistant}>
            Open AI Assistant
            <IonIcon icon={arrowForwardOutline} />
          </button>
        </>
      }
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
          <button className="smartMove" type="button" onClick={openAllocationAssistant}>
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
        <div className="overviewDesktopV2">
          <section className="overviewPulseGrid" aria-label="Portfolio summary">
            <div className="overviewValueCard">
              <span>Portfolio value</span>
              <strong>{fmt.format(analysis.value)}</strong>
              <div className="overviewValueMeta">
                <span className="positive"><IonIcon icon={trendingUpOutline} /> {pct(analysis.currentReturn)}</span>
                <span>modeled 1-year return</span>
              </div>
              <button onClick={() => setScreen('portfolio')}>
                Review holdings <IonIcon icon={arrowForwardOutline} />
              </button>
            </div>

            <div className="overviewFitCard">
              <div className="overviewCardHead">
                <span>Portfolio fit</span>
                <b>{fitLabel}</b>
              </div>
              <strong>{fit}<small>/100</small></strong>
              <div className="overviewFitTrack" aria-label={`Portfolio fit ${fit} out of 100`}>
                <span style={{ width: `${fit}%` }} />
              </div>
              <p>{analysis.concentrations.length ? `${analysis.concentrations.length} concentration flags` : 'Allocation is well diversified'}</p>
            </div>

            <div className="overviewTargetCard">
              <div className="overviewCardHead">
                <span>Target posture</span>
                <b>{title(analysis.riskProfileName)}</b>
              </div>
              <strong>{pct(analysis.targetReturn)}</strong>
              <p>Modeled 1-year target</p>
              <div className="overviewTargetDelta">
                <span>{analysis.targetReturn >= analysis.currentReturn ? '+' : ''}{pct(analysis.targetReturn - analysis.currentReturn)}</span>
                <small>vs current mix</small>
              </div>
            </div>
          </section>

          <div className="overviewCoreGrid">
            <section className="overviewPathPanel">
              <div className="overviewSectionHead dark">
                <div>
                  <span>Trajectory</span>
                  <h2>Your modeled path</h2>
                </div>
                <span className="overviewLiveBadge">Updates with allocation</span>
              </div>
              <FolioPathChart currentReturn={analysis.currentReturn} targetReturn={analysis.targetReturn} />
            </section>

            <section className="overviewDecisionPanel">
              <div className="overviewSectionHead">
                <div>
                  <span>Decision queue</span>
                  <h2>What to act on</h2>
                </div>
                <button aria-label="Open AI Assistant with allocation context" onClick={openAllocationAssistant}>
                  <IonIcon icon={compassOutline} />
                </button>
              </div>

              {smartMove && (
                <button className="overviewSmartMove" onClick={openAllocationAssistant}>
                  <span><IonIcon icon={sparklesOutline} /></span>
                  <span>
                    <small>Best next simulation</small>
                    <strong>Increase {assetName(smartMove.asset)} {pct(smartMove.delta, 0)}</strong>
                    <em>{moveDetail(smartMove.asset)}</em>
                  </span>
                  <IonIcon icon={arrowForwardOutline} />
                </button>
              )}

              <div className="overviewSignalList">
                <button onClick={() => setScreen('portfolio')}>
                  <span className={topConcern ? 'warn' : 'good'}><IonIcon icon={topConcern ? alertCircleOutline : shieldCheckmarkOutline} /></span>
                  <span>
                    <strong>{topConcern ? `${topConcern.label} concentration` : 'Diversification looks healthy'}</strong>
                    <small>{topConcern ? `${pct(topConcern.weight)} of portfolio needs review` : 'No material concentration flags'}</small>
                  </span>
                  <IonIcon icon={chevronForwardOutline} />
                </button>
                <button onClick={() => setScreen('stock')}>
                  <span><IonIcon icon={trendingUpOutline} /></span>
                  <span>
                    <strong>Latest analysis: {stock.symbol}</strong>
                    <small>{stock.rating} · {pct(stock.probGain)} probability of gain</small>
                  </span>
                  <IonIcon icon={chevronForwardOutline} />
                </button>
              </div>
            </section>
          </div>

          <section className="overviewAllocationPanel">
            <div className="overviewSectionHead">
              <div>
                <span>Allocation drift</span>
                <h2>Current mix vs target</h2>
              </div>
              <button onClick={() => setScreen('portfolio')}>Open portfolio <IonIcon icon={arrowForwardOutline} /></button>
            </div>
            <div className="overviewGapGrid">
              {gapMoves.map(([asset, delta]) => {
                const current = analysis.current[asset] ?? 0
                const target = analysis.target[asset] ?? 0
                return (
                  <button key={asset} onClick={() => setScreen('portfolio')}>
                    <span className="overviewGapName">{assetName(asset)}</span>
                    <span className="overviewGapValues"><b>{pct(current)}</b><IonIcon icon={arrowForwardOutline} /><b>{pct(target)}</b></span>
                    <span className={delta >= 0 ? 'need' : 'trim'}>{delta >= 0 ? 'Add' : 'Trim'} {pct(Math.abs(delta))}</span>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </AppPage>
  )
}
