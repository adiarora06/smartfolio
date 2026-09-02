// AI Assistant — deterministic planning plus reproducible Monte Carlo ranges.

import { useEffect, useRef, useState } from 'react'
import { usePortfolioAnalysis } from '../../../hooks/usePortfolioAnalysis'
import {
  DEFAULT_SIMULATION_SEED,
  projectScenario,
  type AdvisorScenarioContext,
  type ScenarioProjection,
  type ScenarioSimulation,
} from '../../../lib/calculations/scenario'
import {
  apiRunScenarioLab,
  type ScenarioLabResult,
} from '../../../lib/api/client'
import { fmt, pct } from '../../../lib/format'
import { IonIcon, IonRange } from '@ionic/react'
import {
  arrowForwardOutline,
  analyticsOutline,
  bookmarkOutline,
  calculatorOutline,
  chatbubbleEllipsesOutline,
  closeOutline,
  flagOutline,
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

const ASSISTANT_ORIGIN_LABELS = {
  overview: 'Overview',
  portfolio: 'Portfolio',
  analyze: 'Analyze',
} as const

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

/** Percentile fan for the seeded monthly path simulation. */
function MonteCarloChart({ simulation }: { simulation: ScenarioSimulation }) {
  const W = 560
  const H = 176
  const PAD = { top: 18, right: 12, bottom: 24, left: 12 }
  const max = Math.max(simulation.goalValue, ...simulation.points.map((point) => point.p90), 1)
  const min = Math.min(...simulation.points.map((point) => point.p10))
  const x = (year: number) =>
    PAD.left + (year / simulation.horizonYears) * (W - PAD.left - PAD.right)
  const y = (value: number) =>
    PAD.top + (1 - (value - min) / (max - min || 1)) * (H - PAD.top - PAD.bottom)
  const line = (key: 'p50') =>
    simulation.points.map((point) => `${x(point.year)},${y(point[key])}`).join(' ')
  const band = (low: 'p10' | 'p25', high: 'p90' | 'p75') => [
    ...simulation.points.map((point) => `${x(point.year)},${y(point[high])}`),
    ...[...simulation.points]
      .reverse()
      .map((point) => `${x(point.year)},${y(point[low])}`),
  ].join(' ')
  const goalY = y(simulation.goalValue)
  const midpoint = Math.floor(simulation.horizonYears / 2)

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Monte Carlo range over ${simulation.horizonYears} years`}
      className="strategyMonteCarloChart"
    >
      <polygon points={band('p10', 'p90')} fill="rgba(79, 70, 229, 0.09)" />
      <polygon points={band('p25', 'p75')} fill="rgba(20, 184, 166, 0.16)" />
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={goalY}
        y2={goalY}
        stroke="#d97706"
        strokeDasharray="6 5"
        strokeWidth="1.5"
      />
      <polyline points={line('p50')} fill="none" stroke="#0f766e" strokeWidth="3" />
      <text x={W - PAD.right} y={Math.max(PAD.top + 10, goalY - 5)} textAnchor="end">
        Goal {fmt.format(simulation.goalValue)}
      </text>
      {[0, midpoint, simulation.horizonYears].map((year) => (
        <text key={year} x={x(year)} y={H - 6} textAnchor="middle">
          {year}y
        </text>
      ))}
    </svg>
  )
}

export function ScenariosScreen() {
  const analysis = usePortfolioAnalysis()
  const chat = useStore((s) => s.chat)
  const advisorPending = useStore((s) => s.advisorPending)
  const assistantHandoff = useStore((s) => s.assistantHandoff)
  const ask = useStore((s) => s.ask)
  const clearAssistantHandoff = useStore((s) => s.clearAssistantHandoff)
  const strategyPlans = useStore((s) => s.strategyPlans)
  const saveStrategyPlan = useStore((s) => s.saveStrategyPlan)
  const removeStrategyPlan = useStore((s) => s.removeStrategyPlan)
  const profile = useStore((s) => s.profile)
  const holdings = useStore((s) => s.holdings)

  // Raw slider positions (dollars, percentage points, and 0..100 intensity).
  const [contribution, setContribution] = useState(750)
  const [returnPts, setReturnPts] = useState(0)
  const [rebalPts, setRebalPts] = useState(50)
  const [goalValue, setGoalValue] = useState(300000)
  const [targetProbability, setTargetProbability] = useState(0.75)
  const [selectedStrategy, setSelectedStrategy] = useState('baseline')
  const [draft, setDraft] = useState('')
  const [scenarioLab, setScenarioLab] = useState<ScenarioLabResult | null>(null)
  const [scenarioPending, setScenarioPending] = useState(true)
  const [scenarioError, setScenarioError] = useState<string | null>(null)
  const [scenarioRetry, setScenarioRetry] = useState(0)
  const chatRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const lastHandoffId = useRef<string | null>(null)

  const returnAdj = returnPts / 100
  const rebalance = rebalPts / 100
  const projection = projectScenario(analysis, { contribution, returnAdj, rebalance })
  const simulation = scenarioLab?.simulation
  const contributionOptimization = scenarioLab?.optimization
  const strategyComparisons = scenarioLab?.comparisons.flatMap((comparison) => {
    const strategy = STRATEGIES.find((candidate) => candidate.id === comparison.id)
    return strategy ? [{ strategy, simulation: comparison.simulation }] : []
  }) ?? []
  const selected = STRATEGIES.find((strategy) => strategy.id === selectedStrategy)
  const contributionLift = projection.series[10] - projection.growthOnlySeries[10]
  const investedOverTenYears = contribution * 12 * 10
  const modeledGrowth = projection.series[10] - analysis.value - investedOverTenYears
  const canSend = draft.trim().length > 0 && !advisorPending
  const scenarioContext: AdvisorScenarioContext | null = simulation ? {
      contribution,
      goalValue,
      horizonYears: simulation.horizonYears,
      modeledReturn: simulation.blendedReturn,
      modeledVolatility: simulation.blendedVolatility,
      successProbability: simulation.successProbability,
      p10: simulation.terminal.p10,
      p50: simulation.terminal.p50,
      p90: simulation.terminal.p90,
      paths: simulation.paths,
    } : null

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      setScenarioPending(true)
      setScenarioError(null)
      void apiRunScenarioLab(
        profile,
        holdings,
        { id: 'current', contribution, returnAdj, rebalance },
        STRATEGIES.map((strategy) => ({
          id: strategy.id,
          contribution: strategy.contribution,
          returnAdj: strategy.returnPts / 100,
          rebalance: strategy.rebalPts / 100,
        })),
        {
          goalValue,
          targetProbability,
          horizonYears: 10,
          simulationPaths: 2000,
          optimizationPaths: 800,
          seed: DEFAULT_SIMULATION_SEED,
          maxContribution: 5000,
          contributionStep: 50,
        },
      )
        .then((result) => {
          if (!cancelled) setScenarioLab(result)
        })
        .catch(() => {
          if (!cancelled) setScenarioError('The Python strategy engine is unavailable.')
        })
        .finally(() => {
          if (!cancelled) setScenarioPending(false)
        })
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [contribution, goalValue, holdings, profile, rebalance, returnAdj, scenarioRetry, targetProbability])

  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat, advisorPending])

  useEffect(() => {
    if (!assistantHandoff || lastHandoffId.current === assistantHandoff.id) return
    lastHandoffId.current = assistantHandoff.id
    setDraft(assistantHandoff.suggestedQuestion)
    const timer = window.setTimeout(() => {
      composerRef.current?.focus()
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [assistantHandoff])

  if (!simulation || !contributionOptimization) {
    return (
      <AppPage
        title="AI Assistant"
        subtitle="Model a theoretical plan and ask AI about it—side by side."
      >
        <section className="strategyEngineState" aria-live="polite">
          <IonIcon icon={scenarioError ? refreshOutline : analyticsOutline} />
          <h2>{scenarioError ? 'Strategy engine unavailable' : 'Calculating your strategy'}</h2>
          <p>
            {scenarioError
              ? 'SmartFolio now calculates probability ranges in its Python backend. Start or reconnect the backend, then try again.'
              : 'The Python engine is running the current plan, four comparisons, and contribution optimizer.'}
          </p>
          {scenarioError && (
            <button className="primary" onClick={() => setScenarioRetry((value) => value + 1)}>
              <IonIcon icon={refreshOutline} /> Retry
            </button>
          )}
        </section>
      </AppPage>
    )
  }

  const applyStrategy = (strategy: StrategyPreset) => {
    setSelectedStrategy(strategy.id)
    setContribution(strategy.contribution)
    setReturnPts(strategy.returnPts)
    setRebalPts(strategy.rebalPts)
  }

  const applySavedPlan = (plan: (typeof strategyPlans)[number]) => {
    setContribution(plan.contribution)
    setReturnPts(plan.returnPts)
    setRebalPts(plan.rebalPts)
    setGoalValue(plan.goalValue)
    setTargetProbability(plan.targetProbability)
    setSelectedStrategy('custom')
  }

  const saveCurrentPlan = () => {
    saveStrategyPlan({
      name: `${selected?.name ?? 'Custom plan'} · ${fmt.format(goalValue)}`,
      contribution,
      returnPts,
      rebalPts,
      goalValue,
      targetProbability,
    })
  }

  const applyOptimizedContribution = () => {
    if (contributionOptimization.capped) return
    setContribution(contributionOptimization.requiredContribution)
    setSelectedStrategy('custom')
  }

  const markCustom = () => setSelectedStrategy('custom')

  const send = () => {
    if (!canSend) return
    void ask(draft, scenarioContext ?? undefined, assistantHandoff ?? undefined)
    setDraft('')
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  const reset = () => {
    applyStrategy(STRATEGIES[0])
    setGoalValue(300000)
    setTargetProbability(0.75)
  }

  const advisorPrompts = [
    `Explain my ${pct(simulation.successProbability)} chance of reaching ${fmt.format(goalValue)} in ${simulation.horizonYears} years, including the percentile range.`,
    `What is the biggest risk in this scenario if I contribute ${fmt.format(contribution)} monthly? My current risk budget usage is ${pct(analysis.risk.riskBudgetUsed)}.`,
    `How could I improve my chance of reaching ${fmt.format(goalValue)} without assuming higher returns? The contribution optimizer estimates ${fmt.format(contributionOptimization.requiredContribution)} monthly for ${pct(targetProbability, 0)} confidence.`,
  ]

  return (
    <AppPage
      title="AI Assistant"
      subtitle="Model a theoretical plan and ask AI about it—side by side."
      actions={
        <>
          <button className="primary" onClick={saveCurrentPlan}>
            <IonIcon icon={bookmarkOutline} /> Save plan
          </button>
          <button onClick={reset}>
            <IonIcon icon={refreshOutline} /> Reset baseline
          </button>
        </>
      }
    >
      <div className="strategyLabScreen">
        {assistantHandoff && (
          <section className="strategySourceContext" aria-labelledby="assistant-source-title">
            <div className="strategySourceContextHead">
              <span><IonIcon icon={sparklesOutline} /></span>
              <div>
                <small>From {ASSISTANT_ORIGIN_LABELS[assistantHandoff.origin]}</small>
                <h2 id="assistant-source-title">{assistantHandoff.title}</h2>
                <p>{assistantHandoff.summary}</p>
              </div>
              <button onClick={clearAssistantHandoff} aria-label="Dismiss assistant source context">
                <IonIcon icon={closeOutline} />
              </button>
            </div>
            <dl>
              {Object.entries(assistantHandoff.facts).map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </section>
        )}

        <section className="strategyPresetStrip" aria-label="Strategy presets">
          {STRATEGIES.map((strategy) => (
            <button
              className={selectedStrategy === strategy.id ? 'active' : ''}
              aria-pressed={selectedStrategy === strategy.id}
              key={strategy.id}
              onClick={() => applyStrategy(strategy)}
            >
              <span>{strategy.eyebrow}</span>
              <strong>{strategy.name}</strong>
              <small>{strategy.description}</small>
            </button>
          ))}
        </section>

        {strategyPlans.length > 0 && (
          <section className="strategySavedShelf" aria-label="Saved strategy plans">
            <div className="strategySavedHead">
              <span><IonIcon icon={bookmarkOutline} /></span>
              <div><strong>Saved plans</strong><small>Stored on this browser</small></div>
            </div>
            <div className="strategySavedList">
              {strategyPlans.map((plan) => (
                <div className="strategySavedCard" key={plan.id}>
                  <button onClick={() => applySavedPlan(plan)}>
                    <strong>{plan.name}</strong>
                    <small>{fmt.format(plan.contribution)}/mo · {pct(plan.targetProbability, 0)} confidence</small>
                  </button>
                  <button
                    aria-label={`Remove ${plan.name}`}
                    className="strategySavedRemove"
                    onClick={() => removeStrategyPlan(plan.id)}
                  >
                    <IonIcon icon={closeOutline} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

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

            <section className="strategySimulationPanel" aria-label="Monte Carlo strategy simulator">
              <div className="strategySimulationHead">
                <div className="strategySimulationTitle">
                  <span><IonIcon icon={analyticsOutline} /></span>
                  <div>
                    <small>Probability lab</small>
                    <h2>Monte Carlo goal range</h2>
                    <p>Seeded monthly paths turn one projection into a visible range of outcomes.</p>
                  </div>
                </div>
                {scenarioError ? (
                  <button
                    className="strategyPathBadge strategyPathBadgeError"
                    onClick={() => setScenarioRetry((value) => value + 1)}
                  >
                    Retry Python model
                  </button>
                ) : (
                  <span className="strategyPathBadge">
                    {scenarioPending ? 'Updating Python model…' : `${simulation.paths.toLocaleString()} backend paths`}
                  </span>
                )}
              </div>

              <label className="strategyGoalControl">
                <span className="strategyGoalLabel">
                  <IonIcon icon={flagOutline} />
                  <span><strong>Goal at year 10</strong></span>
                  <b>{fmt.format(goalValue)}</b>
                </span>
                <IonRange
                  aria-label="Ten-year portfolio goal"
                  min={100000}
                  max={1000000}
                  step={25000}
                  value={goalValue}
                  onIonInput={(event) => setGoalValue(Number(event.detail.value))}
                />
              </label>

              <div className="strategySimulationBody">
                <div className="strategyDistributionColumn">
                  <div className="strategyProbabilityHero">
                    <div
                      className="strategyProbabilityRing"
                      style={{ '--probability': `${simulation.successProbability * 360}deg` } as React.CSSProperties}
                    >
                      <span><strong>{pct(simulation.successProbability, 0)}</strong><small>goal chance</small></span>
                    </div>
                    <div className="strategyTerminalMetrics">
                      <div><span>Downside · P10</span><strong>{fmt.format(simulation.terminal.p10)}</strong></div>
                      <div><span>Median · P50</span><strong>{fmt.format(simulation.terminal.p50)}</strong></div>
                      <div><span>Upside · P90</span><strong>{fmt.format(simulation.terminal.p90)}</strong></div>
                      <div><span>Above deposits</span><strong>{pct(simulation.preserveContributionsProbability, 0)}</strong></div>
                    </div>
                  </div>
                  <div className="strategyMonteCarloWrap">
                    <MonteCarloChart simulation={simulation} />
                    <div className="strategySimulationLegend">
                      <span><i className="outerBand" /> 10–90% range</span>
                      <span><i className="innerBand" /> 25–75% range</span>
                      <span><i className="medianLine" /> Median</span>
                    </div>
                  </div>

                  <div className="strategyGoalCoach" aria-label="Contribution optimizer">
                    <div className="strategyGoalCoachTitle">
                      <span><IonIcon icon={calculatorOutline} /></span>
                      <div>
                        <small>Goal coach</small>
                        <strong>Find the monthly contribution</strong>
                        <p>800 shared paths · $50 steps · no return increase.</p>
                      </div>
                    </div>
                    <div className="strategyConfidencePicker" aria-label="Target confidence">
                      <span>Target confidence</span>
                      <div>
                        {[0.6, 0.75, 0.9].map((value) => (
                          <button
                            className={targetProbability === value ? 'active' : ''}
                            aria-pressed={targetProbability === value}
                            key={value}
                            onClick={() => setTargetProbability(value)}
                          >
                            {pct(value, 0)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="strategyOptimizerResult" aria-live="polite">
                      <span>{contributionOptimization.capped ? 'Required amount' : 'Estimated minimum'}</span>
                      <strong>
                        {contributionOptimization.capped
                          ? `More than ${fmt.format(contributionOptimization.maxContribution)}/mo`
                          : `${fmt.format(contributionOptimization.requiredContribution)}/month`}
                      </strong>
                      <small>
                        {contributionOptimization.capped
                          ? `${pct(contributionOptimization.achievedProbability, 0)} chance at the current slider limit`
                          : contributionOptimization.requiredContribution > contribution
                            ? `Increase by ${fmt.format(contributionOptimization.requiredContribution - contribution)}/month`
                            : contributionOptimization.requiredContribution < contribution
                              ? `Current plan is ${fmt.format(contribution - contributionOptimization.requiredContribution)}/month above this estimate`
                              : 'Current contribution matches the estimate'}
                      </small>
                    </div>
                    <button
                      className="strategyApplyOptimizer"
                      disabled={
                        contributionOptimization.capped ||
                        contributionOptimization.requiredContribution === contribution
                      }
                      onClick={applyOptimizedContribution}
                    >
                      Apply amount <IonIcon icon={arrowForwardOutline} />
                    </button>
                  </div>
                </div>

                <div className="strategyComparePanel">
                  <div className="strategyCompareHead">
                    <span>Same goal, same random paths</span>
                    <h3>Compare approaches</h3>
                  </div>
                  <div className="strategyCompareList">
                    {strategyComparisons.map(({ strategy, simulation: comparison }) => {
                      const result = strategy.id === selectedStrategy ? simulation : comparison
                      return (
                        <button
                          className={strategy.id === selectedStrategy ? 'active' : ''}
                          aria-pressed={strategy.id === selectedStrategy}
                          key={strategy.id}
                          onClick={() => applyStrategy(strategy)}
                        >
                          <span className="strategyCompareCopy">
                            <strong>{strategy.name}</strong>
                            <small>{fmt.format(strategy.contribution)}/month</small>
                          </span>
                          <b>{pct(result.successProbability, 0)}</b>
                          <span className="strategyCompareMedian">Median {fmt.format(result.terminal.p50)}</span>
                          <span className="strategyCompareTrack"><i style={{ width: `${result.successProbability * 100}%` }} /></span>
                        </button>
                      )
                    })}
                  </div>
                  <p>Python computes every comparison with one seed so each strategy faces equivalent market paths.</p>
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
              <div className="strategyRiskContext" aria-label="Current portfolio risk context">
                <div>
                  <span>Portfolio volatility</span>
                  <strong>{pct(analysis.risk.annualizedVolatility)}</strong>
                </div>
                <div>
                  <span>Profile budget</span>
                  <strong>{pct(analysis.risk.riskBudgetUsed)} used</strong>
                </div>
                <div>
                  <span>Top risk driver</span>
                  <strong>{analysis.risk.topContributors[0]?.label ?? '—'}</strong>
                </div>
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
              <span>{fmt.format(goalValue)} goal</span>
              <span>{pct(simulation.successProbability, 0)} goal chance</span>
              <span>{fmt.format(simulation.terminal.p50)} median</span>
            </div>

            <div className="strategyChat" ref={chatRef} aria-live="polite">
              {chat.map((message, index) => (
                <div className={`strategyMessage ${message.role}`} key={index}>
                  {message.role === 'ai' && <span className="strategyAiIcon"><IonIcon icon={chatbubbleEllipsesOutline} /></span>}
                  <p>
                    {message.sourceContext && (
                      <small className="strategyMessageSource">
                        From {ASSISTANT_ORIGIN_LABELS[message.sourceContext.origin]} · {message.sourceContext.title}
                      </small>
                    )}
                    {message.text}
                  </p>
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
                <button
                  key={prompt}
                  onClick={() => void ask(prompt, scenarioContext ?? undefined, assistantHandoff ?? undefined)}
                  disabled={advisorPending}
                >
                  <span>{index + 1}</span>
                  {index === 0 ? 'Explain goal probability' : index === 1 ? 'Find the biggest risk' : 'Improve without more return'}
                  <IonIcon icon={arrowForwardOutline} />
                </button>
              ))}
            </div>

            <div className="strategyComposer">
              <textarea
                ref={composerRef}
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
