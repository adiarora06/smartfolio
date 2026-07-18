// Connections hub — brokerages, market data, CSV, MCP tools, A2A agents.
// The first card is the REAL backend connection (live health status); the rest
// are the planned-integration demo toggles. Export produces a full session
// snapshot, using the backend's canonical analysis when it is online.

import { useStore, type EngineSource } from '../../../store/useStore'
import { analyzePortfolio } from '../../../lib/calculations/portfolio'
import { describeInsights } from '../../../lib/ai/insights'
import { apiAnalyzePortfolio, type PortfolioAnalyzeResult } from '../../../lib/api/client'
import { AppHero, Panel, PanelHead } from '../../shared/ui'

export function ConnectionsScreen() {
  const connections = useStore((s) => s.connections)
  const toggleConnection = useStore((s) => s.toggleConnection)
  const backendOnline = useStore((s) => s.backendOnline)
  const checkBackend = useStore((s) => s.checkBackend)

  const exportJson = async () => {
    const { profile, holdings, connections, stock } = useStore.getState()
    // Canonical analysis from the backend when available; local mirror otherwise.
    let result: PortfolioAnalyzeResult
    let source: EngineSource
    try {
      result = await apiAnalyzePortfolio(profile, holdings)
      source = 'api'
    } catch {
      const analysis = analyzePortfolio(holdings, profile)
      result = { analysis, insights: describeInsights(analysis) }
      source = 'local'
    }
    const payload = { source, profile, holdings, connections, stock, ...result }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'smartfolio-export.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="screen active" id="connections">
      <AppHero
        title="Connections"
        subtitle="Brokerages, market data, CSV import, MCP tools, and A2A agents."
        actions={<button onClick={() => void exportJson()}>Export JSON</button>}
      />
      <Panel>
        <PanelHead title="Available integrations" />
        <div className="body">
          <div className="connGrid">
            <div className={`conn ${backendOnline ? 'on' : ''}`}>
              <strong>SmartFolio API</strong>
              <span style={{ color: 'var(--muted)' }}>Analysis service · live market data</span>
              <button onClick={() => void checkBackend()}>
                {backendOnline === null ? 'Checking…' : backendOnline ? 'Live · Recheck' : 'Offline · Retry'}
              </button>
            </div>
            {connections.map((c, i) => (
              <div className={`conn ${c.on ? 'on' : ''}`} key={c.name}>
                <strong>{c.name}</strong>
                <span style={{ color: 'var(--muted)' }}>{c.type}</span>
                <button onClick={() => toggleConnection(i)}>{c.on ? 'Disconnect' : 'Connect'}</button>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </section>
  )
}
