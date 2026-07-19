// Scenario lab — contribution, return, and rebalancing sliders drive a
// deterministic 1/5/10-year projection.

import { useState } from 'react'
import { usePortfolioAnalysis } from '../../../hooks/usePortfolioAnalysis'
import { projectScenario } from '../../../lib/calculations/scenario'
import { fmt, pct } from '../../../lib/format'
import { AppHero, Panel, PanelHead } from '../../shared/ui'

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
    <section className="screen active" id="scenarios">
      <AppHero title="Scenario lab" subtitle="Drag the sliders — projections update live." />
      <div className="grid2">
        <Panel>
          <PanelHead title="Controls" />
          <div className="body">
            <label>
              Monthly contribution <span>{fmt.format(contribution)}</span>
              <input
                type="range"
                min={0}
                max={5000}
                step={50}
                value={contribution}
                onChange={(e) => setContribution(Number(e.target.value))}
              />
            </label>
            <br />
            <label>
              Return adjustment <span>{(returnAdj >= 0 ? '+' : '') + pct(returnAdj)}</span>
              <input
                type="range"
                min={-8}
                max={8}
                step={0.5}
                value={returnPts}
                onChange={(e) => setReturnPts(Number(e.target.value))}
              />
            </label>
            <br />
            <label>
              Rebalance intensity <span>{pct(rebalance, 0)}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={rebalPts}
                onChange={(e) => setRebalPts(Number(e.target.value))}
              />
            </label>
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Projection" />
          <div className="body">
            <div className="metrics">
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
    </section>
  )
}
