// Guided onboarding wizard.
//
// Note: the original static prototype rendered these inputs but never captured
// them into the profile. Here they are wired to the store, so the investor
// context actually flows into the rest of the app (e.g. the Review step and the
// dashboard risk profile update live). The UI and step flow are unchanged.

import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { SkipToDemoButton } from '../layout/SkipToDemoButton'
import { riskProfile } from '../../lib/calculations/portfolio'
import { title } from '../../lib/format'
import {
  GOALS,
  SETUP_COPY,
  SETUP_STEPS,
  SETUP_TITLES,
} from '../../lib/data/constants'
import type { Goal, Liquidity } from '../../types'

const SOURCES: Array<[id: string, name: string, desc: string]> = [
  ['demo', 'Demo Data', 'Use sample holdings instantly.'],
  ['brokerage', 'Brokerage', 'Plaid-style live accounts later.'],
  ['csv', 'CSV Import', 'Broker export workflow.'],
]

export function SetupFlow() {
  const setupStep = useStore((s) => s.setupStep)
  const profile = useStore((s) => s.profile)
  const holdings = useStore((s) => s.holdings)
  const connections = useStore((s) => s.connections)
  const updateProfile = useStore((s) => s.updateProfile)
  const nextSetupStep = useStore((s) => s.nextSetupStep)
  const prevSetupStep = useStore((s) => s.prevSetupStep)

  const [source, setSource] = useState('demo')

  return (
    <section className="page active" id="setup">
      <div className="setupShell">
        <aside className="panel">
          <div className="body">
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Setup path</h2>
            <div className="steps">
              {SETUP_STEPS.map(([name, desc], i) => (
                <div className={`step ${i === setupStep ? 'active' : ''}`} key={name}>
                  <strong>
                    {i + 1}. {name}
                  </strong>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="panel">
          <div className="setupHead">
            <div>
              <h1>{SETUP_TITLES[setupStep]}</h1>
              <p>{SETUP_COPY[setupStep]}</p>
            </div>
            <SkipToDemoButton />
          </div>

          <div className="body">
            {setupStep === 0 && (
              <div className="formgrid">
                <label>
                  Age
                  <input
                    type="number"
                    value={profile.age}
                    onChange={(e) => updateProfile({ age: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Annual income
                  <input
                    type="number"
                    value={profile.income}
                    onChange={(e) => updateProfile({ income: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Monthly contribution
                  <input
                    type="number"
                    value={profile.contribution}
                    onChange={(e) => updateProfile({ contribution: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Emergency fund months
                  <input
                    type="number"
                    value={profile.emergency}
                    onChange={(e) => updateProfile({ emergency: Number(e.target.value) })}
                  />
                </label>
              </div>
            )}

            {setupStep === 1 && (
              <div className="formgrid">
                <label>
                  Investment horizon
                  <input
                    type="number"
                    value={profile.horizon}
                    onChange={(e) => updateProfile({ horizon: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Risk tolerance
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={profile.risk}
                    onChange={(e) => updateProfile({ risk: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Goal
                  <select
                    value={profile.goal}
                    onChange={(e) => updateProfile({ goal: e.target.value as Goal })}
                  >
                    {GOALS.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Liquidity
                  <select
                    value={profile.liquidity}
                    onChange={(e) => updateProfile({ liquidity: e.target.value as Liquidity })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </div>
            )}

            {setupStep === 2 && (
              <div className="choiceGrid">
                {SOURCES.map(([id, name, desc]) => (
                  <div
                    className={`choice ${source === id ? 'selected' : ''}`}
                    key={id}
                    onClick={() => setSource(id)}
                  >
                    <strong>{name}</strong>
                    <span>{desc}</span>
                  </div>
                ))}
              </div>
            )}

            {setupStep === 3 && (
              <div className="metrics">
                <div className="metric">
                  <span>Risk</span>
                  <strong>{title(riskProfile(profile)[0])}</strong>
                </div>
                <div className="metric">
                  <span>Demo Holdings</span>
                  <strong>{holdings.length}</strong>
                </div>
                <div className="metric">
                  <span>Connected</span>
                  <strong>{connections.filter((c) => c.on).length}</strong>
                </div>
                <div className="metric">
                  <span>Ready</span>
                  <strong>Yes</strong>
                </div>
              </div>
            )}
          </div>

          <div className="setupActions">
            <button onClick={prevSetupStep}>Back</button>
            <button className="primary" onClick={nextSetupStep}>
              Continue
            </button>
          </div>
        </main>
      </div>
    </section>
  )
}
