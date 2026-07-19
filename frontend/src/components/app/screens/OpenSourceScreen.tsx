// Open Source — the "how it works" home.
//
// All system internals (agent network, agent graph, pipeline flow, design
// rules) live here, deliberately out of the customer-facing screens. The
// everyday workflow shows results; this tab shows the machinery.
//
// The graph mirrors the REAL backend trace emitted by app/orchestrator.py —
// the same seven steps the Analyze Stock "Audit Log" tab renders. Keep the two
// in sync: if the orchestrator's emit() sequence changes, update this file.

import { useState } from 'react'
import { useStore } from '../../../store/useStore'
import { AppHero, Panel, PanelHead } from '../../shared/ui'

const REPO_URL = 'https://github.com/adiarora06/smartfolio'

// Pipeline order matches orchestrator.py exactly.
const AGENT_DETAILS: Array<[name: string, role: string]> = [
  ['Ticker Intake Agent', 'Normalizes the symbol and clamps the horizon to 7–365 days.'],
  ['Market Data Tool', 'Resolves the live price (Finnhub / Alpha Vantage) with an offline reference backstop.'],
  ['Stock Forecast Agent', 'Builds bear / median / bull paths with a confidence score.'],
  ['Backtest Agent', 'Evaluates sample windows: hit rate, mean error, drawdown proxy.'],
  ['Portfolio Agent', 'Runs the what-if: how the position would shift portfolio weight and sector concentration.'],
  ['Memo Writer', 'AI explanation layer — narrates the memo via LLM (gpt-4o-mini) or a deterministic template.'],
  ['Compliance Agent', 'Validates every output as educational — no advice, no guarantees; serves the template if narration fails.'],
]

const PIPELINE: string[] = [
  'Ticker Intake normalizes the symbol and clamps the horizon.',
  'Market Data Tool resolves the price (live provider or offline reference).',
  'Stock Forecast Agent creates median, bear, and bull paths.',
  'Backtest Agent evaluates sample windows.',
  'Portfolio Agent checks concentration against your holdings.',
  'Memo Writer narrates the result (LLM when configured, template otherwise).',
  'Compliance Agent frames the output as educational analysis.',
]

// Role lookup for the graph node tooltips/selection (keyed by label).
const ROLE_BY_LABEL: Record<string, string> = Object.fromEntries(AGENT_DETAILS)

interface GraphNode {
  label: string
  x: number
  y: number
  kind: 'agent' | 'tool' | 'guard'
}

// Snake layout of the real linear pipeline: top row flows left→right, drops
// down at the right edge, bottom row flows right→left to the Compliance guard.
const NODES: GraphNode[] = [
  { label: 'Ticker Intake Agent', x: 15, y: 40, kind: 'agent' },
  { label: 'Market Data Tool', x: 210, y: 40, kind: 'tool' },
  { label: 'Stock Forecast Agent', x: 405, y: 40, kind: 'agent' },
  { label: 'Backtest Agent', x: 600, y: 40, kind: 'agent' },
  { label: 'Portfolio Agent', x: 600, y: 200, kind: 'agent' },
  { label: 'Memo Writer', x: 405, y: 200, kind: 'agent' },
  { label: 'Compliance Agent', x: 210, y: 200, kind: 'guard' },
]

// Edge lines between node borders (coordinates match NODES above; w=145 h=44).
const EDGES: Array<[x1: number, y1: number, x2: number, y2: number]> = [
  [160, 62, 206, 62], // Ticker Intake -> Market Data
  [355, 62, 401, 62], // Market Data -> Stock Forecast
  [550, 62, 596, 62], // Stock Forecast -> Backtest
  [672, 88, 672, 196], // Backtest -> Portfolio (drop down)
  [600, 222, 554, 222], // Portfolio -> Memo Writer (right to left)
  [405, 222, 359, 222], // Memo Writer -> Compliance (guardrail last)
]

const NODE_STYLE: Record<GraphNode['kind'], { stroke: string; fill: string }> = {
  agent: { stroke: 'rgba(94,234,212,.5)', fill: 'rgba(94,234,212,.08)' },
  tool: { stroke: 'rgba(96,165,250,.55)', fill: 'rgba(96,165,250,.09)' },
  guard: { stroke: 'rgba(245,158,11,.6)', fill: 'rgba(245,158,11,.09)' },
}

function AgentGraph({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (label: string) => void
}) {
  return (
    <svg className="svgbox" viewBox="0 0 760 288" role="img" aria-label="Agent network graph">
      <defs>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="rgba(147,197,253,.6)" />
        </marker>
      </defs>
      {EDGES.map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="rgba(147,197,253,.45)"
          strokeWidth="1.6"
          markerEnd="url(#arrow)"
        />
      ))}
      {NODES.map((n) => {
        const isSel = selected === n.label
        return (
          <g
            key={n.label}
            onClick={() => onSelect(n.label)}
            style={{ cursor: 'pointer' }}
          >
            <title>{ROLE_BY_LABEL[n.label]}</title>
            <rect
              x={n.x}
              y={n.y}
              width={145}
              height={44}
              rx={10}
              fill={isSel ? NODE_STYLE[n.kind].stroke : NODE_STYLE[n.kind].fill}
              stroke={NODE_STYLE[n.kind].stroke}
              strokeWidth={isSel ? 2.4 : 1.4}
            />
            <text
              x={n.x + 72.5}
              y={n.y + 27}
              textAnchor="middle"
              fill="#fff"
              fontSize="11.5"
              fontWeight="700"
              style={{ pointerEvents: 'none' }}
            >
              {n.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 16 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

export function OpenSourceScreen() {
  const backendOnline = useStore((s) => s.backendOnline)
  const agentStatus = backendOnline ? 'Active · API' : 'Active · local mirror'
  // Clicking a graph node selects it and highlights its row in the agent list.
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <section className="screen active" id="opensource">
      <AppHero
        title="Open source"
        subtitle="How SmartFolio works under the hood — the agent network, data flow, and design rules. Kept out of the everyday workflow on purpose."
        actions={
          <button onClick={() => window.open(REPO_URL, '_blank', 'noopener')}>View on GitHub</button>
        }
      />

      <section className="terminal">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2>Agent graph</h2>
            <span style={{ color: '#93c5fd' }}>
              The real pipeline: intake → market data → forecast → backtest → portfolio what-if → AI
              memo → compliance guard. Click a node to see its role.
            </span>
          </div>
          <span>{agentStatus}</span>
        </div>
        <AgentGraph selected={selected} onSelect={(label) => setSelected(label)} />
        <div style={{ color: '#93c5fd', fontSize: 12 }}>
          <LegendSwatch color="rgba(94,234,212,.7)" label="Agent" />
          <LegendSwatch color="rgba(96,165,250,.75)" label="Tool" />
          <LegendSwatch color="rgba(245,158,11,.8)" label="Guardrail" />
        </div>
      </section>

      <div className="grid2">
        <Panel>
          <PanelHead title="Active agents" subtitle="The seven-step network behind every analysis." />
          <div className="body">
            <ul className="list">
              {AGENT_DETAILS.map(([name, role]) => {
                const isSel = selected === name
                return (
                  <li
                    key={name}
                    onClick={() => setSelected(name)}
                    style={{
                      cursor: 'pointer',
                      borderRadius: 8,
                      padding: isSel ? '6px 8px' : undefined,
                      background: isSel ? 'rgba(94,234,212,.08)' : undefined,
                      outline: isSel ? '1px solid rgba(94,234,212,.4)' : undefined,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <strong>{name}</strong>
                      <span style={{ color: 'var(--green)', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>
                        ● {agentStatus}
                      </span>
                    </div>
                    <span style={{ color: 'var(--muted)', fontSize: 13 }}>{role}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        </Panel>

        <Panel>
          <PanelHead title="How a run flows" subtitle="What happens when you hit Run Analysis." />
          <div className="body">
            <ul className="list">
              {PIPELINE.map((step, i) => (
                <li key={i}>
                  {i + 1}. {step}
                </li>
              ))}
            </ul>
            <div className="foot" style={{ marginTop: 12 }}>
              Design rule: deterministic code calculates every number; AI only explains. Source, docs,
              and architecture notes live in the GitHub repo.
            </div>
          </div>
        </Panel>
      </div>
    </section>
  )
}
