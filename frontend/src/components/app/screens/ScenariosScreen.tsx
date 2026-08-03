// Scenario lab — contribution, return, and rebalancing sliders drive a
// deterministic 1/5/10-year projection.

import { useEffect, useRef, useState } from 'react'
import { usePortfolioAnalysis } from '../../../hooks/usePortfolioAnalysis'
import { projectScenario, type ScenarioProjection } from '../../../lib/calculations/scenario'
import { fmt, pct } from '../../../lib/format'
import { IonIcon, IonRange } from '@ionic/react'
import {
  arrowForwardOutline,
  chatbubbleEllipsesOutline,
  refreshOutline,
  sendOutline,
  shieldCheckmarkOutline,
  sparklesOutline,
  trendingUpOutline,
} from 'ionicons/icons'
import { useStore } from '../../../store/useStore'
import { AppPage } from '../../shared/AppPage'

interface StrategyPreset {
  id: string
  name: string
  eyebrow: string
  description: string
  contribution: number
  returnPts: number
  rebalPts: number
}

const STRATEGIES: StrategyPreset[] = [
  {
    id: 'baseline',
    name: 'Stay the course',
    eyebrow: 'Balanced',
    description: 'Keep assumptions neutral and move halfway toward your target allocation.',
    contribution: 750,
    returnPts: 0,
    rebalPts: 50,
  },
  {
    id: 'accelerate',
    name: 'Accelerate growth',
    eyebrow: 'Higher upside',
    description: 'Raise contributions and accept a modestly stronger return assumption.',
    contribution: 1500,
    returnPts: 2,
    rebalPts: 65,
  },
  {
    id: 'stability',
    name: 'Build stability',
    eyebrow: 'Lower variance',
    description: 'Model a cautious return while moving more decisively toward the target mix.',
    contribution: 900,
    returnPts: -2,
    rebalPts: 90,
  },
  {
    id: 'contribute',
    name: 'Contribution first',
    eyebrow: 'Behavior-led',
    description: 'Let saving do more of the work without assuming better market performance.',
    contribution: 2500,
    returnPts: 0,
    rebalPts: 50,
  },
]

/** Two-line SVG projection chart: with contributions vs growth only. */
function ProjectionChart({ projection }: { projection: ScenarioProjection }) {
  const W = 560
  const H = 180
  const PAD = { top: 14, right: 10, bottom: 22, left: 10 }
  const max = Math.max(...projection.series) || 1
  const min = Math.min(projection.growthOnlySeries[0], projection.series[0])
  const x = (year: number) => PAD.left + (year / 10) * (W - PAD.left - PAD.right)
  const y = (v: number) =>
    PAD.top + (1 - (v - min) / (max - min || 1)) * (H - PAD.top - PAD.bottom)
  const line = (values: number[]) => values.map((v, yr) => `${x(yr)},${y(v)}`).join(' ')

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Projection chart: portfolio value over ten years"
      className="strategyProjectionChart"
    >
      <polyline
        points={line(projection.growthOnlySeries)}
        fill="none"
        stroke="#94a3b8"
        strokeWidth="2"
        strokeDasharray="5 5"
      />
      <polyline points={line(projection.series)} fill="none" stroke="#0f766e" strokeWidth="3.5" />
      {[0, 5, 10].map((yr) => (
        <text key={yr} x={x(yr)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">
          {yr}y
        </text>
      ))}
      <circle cx={x(10)} cy={y(projection.series[10])} r="4" fill="#0f766e" />
    </svg>
  )
}

export function ScenariosScreen() {
  const analysis = usePortfolioAnalysis()
  const chat = useStore((s) => s.chat)
  const advisorPending = useStore((s) => s.advisorPending)
  const ask = useStore((s) => s.ask)

  // Raw slider positions (dollars, percentage points, and 0..100 intensity).
  const [contribution, setContribution] = useState(750)
  const [returnPts, setReturnPts] = useState(0)
  const [rebalPts, setRebalPts] = useState(50)
  const [selectedStrategy, setSelectedStrategy] = useState('baseline')
  const [draft, setDraft] = useState('')
  const chatRef = useRef<HTMLDivElement>(null)

  const returnAdj = returnPts / 100
  const rebalance = rebalPts / 100
  const projection = projectScenario(analysis, { contribution, returnAdj, rebalance })
  const selected = STRATEGIES.find((strategy) => strategy.id === selectedStrategy)
  const contributionLift = projection.series[10] - projection.growthOnlySeries[10]
  const investedOverTenYears = contribution * 12 * 10
  const modeledGrowth = projection.series[10] - analysis.value - investedOverTenYears
  const canSend = draft.trim().length > 0 && !advisorPending

  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat, advisorPending])

  const applyStrategy = (strategy: StrategyPreset) => {
    setSelectedStrategy(strategy.id)
    setContribution(strategy.contribution)
    setReturnPts(strategy.returnPts)
    setRebalPts(strategy.rebalPts)
  }

  const markCustom = () => setSelectedStrategy('custom')

  const send = () => {
    if (!canSend) return
    void ask(draft)
    setDraft('')
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  const reset = () => applyStrategy(STRATEGIES[0])

  const advisorPrompts = [
    `Explain the tradeoffs in my ${selected?.name ?? 'custom'} strategy.`,
    `What is the biggest risk in this scenario if I contribute ${fmt.format(contribution)} monthly?`,
    `How could I improve this 10-year projection without assuming higher returns?`,
  ]

  return (
    <AppPage
      title="AI Assistant"
      subtitle="Model a theoretical plan and ask AI about it—side by side."
      actions={
        <button onClick={reset}>
          <IonIcon icon={refreshOutline} /> Reset baseline
        </button>
      }
    >
      <div className="strategyLabScreen">
        <section className="strategyPresetStrip" aria-label="Strategy presets">
          {STRATEGIES.map((strategy) => (
            <button
              className={selectedStrategy === strategy.id ? 'active' : ''}
              key={strategy.id}
              onClick={() => applyStrategy(strategy)}
            >
              <span>{strategy.eyebrow}</span>
              <strong>{strategy.name}</strong>
              <small>{strategy.description}</small>
            </button>
          ))}
        </section>

        <div className="strategyLabGrid">
          <main className="strategyModelColumn">
            <section className="strategyProjectionPanel">
              <div className="strategyPanelHead dark">
                <div>
                  <span>Theoretical outcome</span>
                  <h2>{selected?.name ?? 'Custom strategy'}</h2>
                </div>
                <div className="strategyAssumptionBadge">
                  <IonIcon icon={trendingUpOutline} />
                  {pct(projection.blendedReturn)} modeled return
                </div>
              </div>

              <div className="strategyMetricStrip">
                {projection.points.map(({ years, value }) => (
                  <div key={years}>
                    <span>{years}Y value</span>
                    <strong>{fmt.format(value)}</strong>
                    <small>{years === 10 ? `${fmt.format(contributionLift)} from contributions` : 'live projection'}</small>
                  </div>
                ))}
                <div>
                  <span>Modeled growth</span>
                  <strong>{fmt.format(modeledGrowth)}</strong>
                  <small>after contributions</small>
                </div>
              </div>

              <div className="strategyChartWrap">
                <ProjectionChart projection={projection} />
                <div className="strategyLegend">
                  <span><i className="withContributions" /> With contributions</span>
                  <span><i className="growthOnly" /> Growth only</span>
                </div>
              </div>
            </section>

            <section className="strategyControlsPanel">
              <div className="strategyPanelHead">
                <div>
                  <span>Assumptions</span>
                  <h2>Shape the strategy</h2>
                </div>
                <span className="strategyCustomState">{selectedStrategy === 'custom' ? 'Custom' : 'Preset'}</span>
              </div>
              <div className="strategyControlGrid">
                <label>
                  <span>Monthly contribution <b>{fmt.format(contribution)}</b></span>
                  <IonRange
                    aria-label="Monthly contribution"
                    min={0}
                    max={5000}
                    step={50}
                    value={contribution}
                    onIonKnobMoveStart={markCustom}
                    onIonInput={(event) => setContribution(Number(event.detail.value))}
                  />
                  <small>Invested over 10 years: {fmt.format(investedOverTenYears)}</small>
                </label>
                <label>
                  <span>Return adjustment <b>{(returnAdj >= 0 ? '+' : '') + pct(returnAdj)}</b></span>
                  <IonRange
                    aria-label="Return adjustment"
                    min={-8}
                    max={8}
                    step={0.5}
                    value={returnPts}
                    onIonKnobMoveStart={markCustom}
                    onIonInput={(event) => setReturnPts(Number(event.detail.value))}
                  />
                  <small>For stress testing—not a prediction.</small>
                </label>
                <label>
                  <span>Rebalance toward target <b>{pct(rebalance, 0)}</b></span>
                  <IonRange
                    aria-label="Rebalance toward target"
                    min={0}
                    max={100}
                    step={5}
                    value={rebalPts}
                    onIonKnobMoveStart={markCustom}
                    onIonInput={(event) => setRebalPts(Number(event.detail.value))}
                  />
                  <small>{rebalPts >= 75 ? 'Strong target alignment' : rebalPts >= 40 ? 'Gradual transition' : 'Current mix dominates'}</small>
                </label>
              </div>
              <div className="strategyGuardrail">
                <IonIcon icon={shieldCheckmarkOutline} />
                <span><strong>Planning guardrail</strong><small>These are deterministic illustrations, not financial advice or guaranteed outcomes.</small></span>
              </div>
            </section>
          </main>

          <aside className="strategyAdvisorPanel">
            <div className="strategyAdvisorHead">
              <span><IonIcon icon={sparklesOutline} /></span>
              <div>
                <small>Scenario-aware</small>
                <h2>Ask AI about this plan</h2>
              </div>
              <span className="advisorStatus">{advisorPending ? 'Thinking' : 'Ready'}</span>
            </div>

            <div className="strategyContextChips" aria-label="Advisor context">
              <span>{fmt.format(contribution)}/mo</span>
              <span>{pct(rebalance, 0)} rebalance</span>
              <span>{fmt.format(projection.series[10])} at 10Y</span>
            </div>

            <div className="strategyChat" ref={chatRef} aria-live="polite">
              {chat.map((message, index) => (
                <div className={`strategyMessage ${message.role}`} key={index}>
                  {message.role === 'ai' && <span className="strategyAiIcon"><IonIcon icon={chatbubbleEllipsesOutline} /></span>}
                  <p>{message.text}</p>
                </div>
              ))}
              {advisorPending && (
                <div className="strategyMessage ai pending">
                  <span className="strategyAiIcon"><IonIcon icon={sparklesOutline} /></span>
                  <p>Reviewing the scenario…</p>
                </div>
              )}
            </div>

            <div className="strategyPromptList">
              {advisorPrompts.map((prompt, index) => (
                <button key={prompt} onClick={() => void ask(prompt)} disabled={advisorPending}>
                  <span>{index + 1}</span>
                  {index === 0 ? 'Explain this plan' : index === 1 ? 'Find the biggest risk' : 'Improve without more return'}
                  <IonIcon icon={arrowForwardOutline} />
                </button>
              ))}
            </div>

            <div className="strategyComposer">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask about this strategy…"
                disabled={advisorPending}
                aria-label="Ask the strategy advisor"
              />
              <button className="primary" onClick={send} disabled={!canSend} aria-label="Send question">
                <IonIcon icon={sendOutline} />
              </button>
            </div>
          </aside>
        </div>
      </div>
    </AppPage>
  )
}
