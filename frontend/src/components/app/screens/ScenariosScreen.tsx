// Scenario lab — contribution, return, and rebalancing sliders drive a
// deterministic 1/5/10-year projection.

import { useState } from 'react'
import { usePortfolioAnalysis } from '../../../hooks/usePortfolioAnalysis'
import { projectScenario, type ScenarioProjection } from '../../../lib/calculations/scenario'
import { fmt, pct } from '../../../lib/format'
import { IonNote, IonRange } from '@ionic/react'
import { Panel, PanelHead } from '../../shared/ui'
import { AppPage } from '../../shared/AppPage'

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
      style={{ background: 'var(--soft)', borderRadius: 12, border: '1px solid var(--line)' }}
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

  // Raw slider positions (dollars, percentage points, and 0..100 intensity).
  const [contribution, setContribution] = useState(750)
  const [returnPts, setReturnPts] = useState(0)
  const [rebalPts, setRebalPts] = useState(50)

  const returnAdj = returnPts / 100
  const rebalance = rebalPts / 100
  const projection = projectScenario(analysis, { contribution, returnAdj, rebalance })

  return (
    <AppPage title="Scenarios" subtitle="Drag the sliders — projections update live.">
      <div className="grid2">
        <Panel>
          <PanelHead title="Controls" />
          {/* IonRange rather than <input type=range>: bigger touch target,
              iOS-styled knob, and a live pin while dragging. */}
          <div className="body rangeStack">
            <IonRange
              label="Monthly contribution"
              labelPlacement="stacked"
              min={0}
              max={5000}
              step={50}
              value={contribution}
              onIonInput={(e) => setContribution(Number(e.detail.value))}
            >
              <IonNote slot="end">{fmt.format(contribution)}</IonNote>
            </IonRange>

            <IonRange
              label="Return adjustment"
              labelPlacement="stacked"
              min={-8}
              max={8}
              step={0.5}
              value={returnPts}
              onIonInput={(e) => setReturnPts(Number(e.detail.value))}
            >
              <IonNote slot="end">
                {(returnAdj >= 0 ? '+' : '') + pct(returnAdj)}
              </IonNote>
            </IonRange>

            <IonRange
              label="Rebalance intensity"
              labelPlacement="stacked"
              min={0}
              max={100}
              step={5}
              value={rebalPts}
              onIonInput={(e) => setRebalPts(Number(e.detail.value))}
            >
              <IonNote slot="end">{pct(rebalance, 0)}</IonNote>
            </IonRange>
          </div>
        </Panel>
        <Panel>
          <PanelHead
            title="Projection"
            subtitle={
              <>
                Solid: with contributions · dashed: growth only. Contributions add{' '}
                <strong>
                  {fmt.format(projection.series[10] - projection.growthOnlySeries[10])}
                </strong>{' '}
                over 10 years.
              </>
            }
          />
          <div className="body" style={{ display: 'grid', gap: 14 }}>
            <ProjectionChart projection={projection} />
            {/* No inline grid override: an inline style beats the responsive
                rule and pushed the three horizons off-screen on a phone. */}
            <div className="metrics metrics3">
              {projection.points.map(({ years, value }) => (
                <div className="metric" key={years}>
                  <span>
                    {years} year{years > 1 ? 's' : ''}
                  </span>
                  <strong>{fmt.format(value)}</strong>
                  <small>Blended {pct(projection.blendedReturn)}</small>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </AppPage>
  )
}
