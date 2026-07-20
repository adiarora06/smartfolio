// Connections hub — real integrations first, planned demo toggles after.
//
// Real: the SmartFolio API (live health), Plaid brokerage sync (activates
// when the backend has PLAID keys; full sandbox flow), and the A2A agent
// card (live discovery document any A2A client can read).

import { useState } from 'react'
import { useStore, type EngineSource } from '../../../store/useStore'
import { analyzePortfolio } from '../../../lib/calculations/portfolio'
import { describeInsights } from '../../../lib/ai/insights'
import {
  API_URL,
  apiAnalyzePortfolio,
  apiPlaidImportHoldings,
  apiPlaidLinkToken,
  type PortfolioAnalyzeResult,
} from '../../../lib/api/client'
import { AppHero, Panel, PanelHead } from '../../shared/ui'

declare global {
  interface Window {
    Plaid?: {
      create: (opts: {
        token: string
        onSuccess: (publicToken: string) => void
        onExit: () => void
      }) => { open: () => void }
    }
  }
}

/** Load Plaid Link's script once, on demand. */
async function loadPlaidLink(): Promise<NonNullable<typeof window.Plaid>> {
  if (!window.Plaid) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Plaid Link failed to load'))
      document.head.appendChild(s)
    })
  }
  if (!window.Plaid) throw new Error('Plaid Link unavailable')
  return window.Plaid
}

function PlaidCard() {
  const health = useStore((s) => s.health)
  const importHoldings = useStore((s) => s.importHoldings)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const configured = health?.plaid === true

  const connect = async () => {
    setBusy(true)
    setNote(null)
    try {
      const { linkToken } = await apiPlaidLinkToken()
      const Plaid = await loadPlaidLink()
      Plaid.create({
        token: linkToken,
        onSuccess: (publicToken) => {
          void (async () => {
            try {
              const result = await apiPlaidImportHoldings(publicToken)
              setNote(
                `Imported ${result.holdings.length} holdings` +
                  (result.institution ? ` from ${result.institution}` : ''),
              )
              importHoldings(result.holdings)
            } catch {
              setNote('Import failed — try again.')
            } finally {
              setBusy(false)
            }
          })()
        },
        onExit: () => setBusy(false),
      }).open()
    } catch {
      setNote('Could not start Plaid Link.')
      setBusy(false)
    }
  }

  return (
    <div className={`conn ${configured ? 'on' : ''}`}>
      <strong>Plaid Brokerage</strong>
      <span style={{ color: 'var(--muted)' }}>
        {configured
          ? 'Live · import real holdings via Plaid Link'
          : 'Ready — needs PLAID_CLIENT_ID + PLAID_SECRET on the backend (free sandbox)'}
      </span>
      {note && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{note}</span>}
      <button onClick={() => void connect()} disabled={!configured || busy}>
        {busy ? 'Connecting…' : configured ? 'Connect Brokerage' : 'Not Configured'}
      </button>
    </div>
  )
}

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
        subtitle="Three live integrations, four planned."
        actions={<button onClick={() => void exportJson()}>Export JSON</button>}
      />
      <Panel>
        <PanelHead title="Live" subtitle="Working integrations — not toggles." />
        <div className="body">
          <div className="connGrid">
            <div className={`conn ${backendOnline ? 'on' : ''}`}>
              <strong>SmartFolio API</strong>
              <span style={{ color: 'var(--muted)' }}>Analysis service · live market data</span>
              <button onClick={() => void checkBackend()}>
                {backendOnline === null ? 'Checking…' : backendOnline ? 'Live · Recheck' : 'Offline · Retry'}
              </button>
            </div>
            <PlaidCard />
            <div className={`conn ${backendOnline ? 'on' : ''}`}>
              <strong>A2A Agent Card</strong>
              <span style={{ color: 'var(--muted)' }}>
                SmartFolio as a discoverable agent — a live agent card lists its
                skills for other A2A clients
              </span>
              <button
                onClick={() =>
                  window.open(`${API_URL}/.well-known/agent.json`, '_blank', 'noopener')
                }
              >
                View Agent Card
              </button>
            </div>
          </div>
        </div>
      </Panel>
      <Panel>
        <PanelHead title="Planned" subtitle="Demo toggles for the roadmap." />
        <div className="body">
          <div className="connGrid">
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
