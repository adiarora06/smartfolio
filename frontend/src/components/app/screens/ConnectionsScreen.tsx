// Connections hub — real integrations first, roadmap items after.
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
import { Panel, PanelHead } from '../../shared/ui'
import { AppPage } from '../../shared/AppPage'
import { openExternal, shareText } from '../../../lib/browser'

type ConnectionState =
  | 'checking'
  | 'available'
  | 'ready'
  | 'setup-required'
  | 'offline'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'planned'

const CONNECTION_STATE_LABELS: Record<ConnectionState, string> = {
  checking: 'Checking',
  available: 'Available',
  ready: 'Ready',
  'setup-required': 'Setup required',
  offline: 'Offline',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Error',
  planned: 'Planned',
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <span className={`connectionBadge connectionBadge--${state}`}>
      {CONNECTION_STATE_LABELS[state]}
    </span>
  )
}

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
  const backendOnline = useStore((s) => s.backendOnline)
  const importHoldings = useStore((s) => s.importHoldings)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [result, setResult] = useState<'connected' | 'error' | null>(null)
  const configured = backendOnline === true && health?.plaid === true

  const state: ConnectionState = busy
    ? 'connecting'
    : result === 'connected'
      ? 'connected'
      : result === 'error'
        ? 'error'
        : backendOnline === null || (backendOnline === true && health === null)
          ? 'checking'
          : backendOnline === false
            ? 'offline'
            : configured
              ? 'ready'
              : 'setup-required'

  const description =
    state === 'checking'
      ? 'Checking whether brokerage import is available.'
      : state === 'connecting'
        ? 'Plaid Link is waiting for the brokerage connection to finish.'
      : state === 'offline'
        ? 'The SmartFolio API must be online before Plaid can connect.'
        : state === 'setup-required'
          ? 'Add Plaid credentials to the backend to enable the free sandbox.'
          : state === 'error'
            ? 'The last brokerage connection attempt did not complete.'
          : state === 'connected'
            ? 'Holdings were imported into this portfolio.'
            : 'Ready to import holdings through Plaid Link.'

  const connect = async () => {
    setBusy(true)
    setNote(null)
    setResult(null)
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
              setResult('connected')
              importHoldings(result.holdings)
            } catch {
              setNote('Import failed — try again.')
              setResult('error')
            } finally {
              setBusy(false)
            }
          })()
        },
        onExit: () => setBusy(false),
      }).open()
    } catch {
      setNote('Could not start Plaid Link.')
      setResult('error')
      setBusy(false)
    }
  }

  return (
    <div
      className={`conn connectionCard connectionCard--${state} ${state === 'ready' || state === 'connected' ? 'on' : ''}`}
    >
      <div className="connectionCardHead">
        <strong>Plaid Brokerage</strong>
        <ConnectionBadge state={state} />
      </div>
      <span className="connectionDescription">{description}</span>
      {note && (
        <span
          className={`connectionResult connectionResult--${result ?? 'info'}`}
          role="status"
          aria-live="polite"
        >
          {note}
        </span>
      )}
      <button onClick={() => void connect()} disabled={!configured || busy}>
        {busy
          ? 'Connecting…'
          : state === 'connected'
            ? 'Reconnect Brokerage'
            : configured
              ? 'Connect Brokerage'
              : state === 'checking'
                ? 'Checking availability…'
                : state === 'offline'
                  ? 'API Offline'
                  : 'Setup Required'}
      </button>
    </div>
  )
}

export function ConnectionsScreen() {
  const connections = useStore((s) => s.connections)
  const setScreen = useStore((s) => s.setScreen)
  const backendOnline = useStore((s) => s.backendOnline)
  const checkBackend = useStore((s) => s.checkBackend)
  const [checkingApi, setCheckingApi] = useState(false)

  const apiState: ConnectionState =
    checkingApi || backendOnline === null
      ? 'checking'
      : backendOnline
        ? 'available'
        : 'offline'

  const recheckBackend = async () => {
    setCheckingApi(true)
    try {
      await checkBackend()
    } finally {
      setCheckingApi(false)
    }
  }

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
    // Native gets the system share sheet; the browser keeps Web Share, then a
    // download. The old download-only path silently did nothing on iOS.
    await shareText({
      title: 'SmartFolio export',
      text: JSON.stringify(payload, null, 2),
      filename: 'smartfolio-export.json',
    })
  }

  return (
    <AppPage
      title="Connections"
      subtitle="Use available data paths now and see what is planned next."
      actions={<button onClick={() => void exportJson()}>Share Export</button>}
    >
      <Panel>
        <PanelHead
          title="Available now"
          subtitle="Current capabilities with live, setup, and availability states."
        />
        <div className="body">
          <div className="connGrid connectionAvailableGrid">
            <div
              className={`conn connectionCard connectionCard--${apiState} ${apiState === 'available' ? 'on' : ''}`}
            >
              <div className="connectionCardHead">
                <strong>SmartFolio API</strong>
                <ConnectionBadge state={apiState} />
              </div>
              <span className="connectionDescription">
                {apiState === 'checking'
                  ? 'Checking the analysis service and market-data connection.'
                  : apiState === 'available'
                    ? 'Analysis service and live market-data access are available.'
                    : 'Local analysis still works while the API is unavailable.'}
              </span>
              <button onClick={() => void recheckBackend()} disabled={checkingApi}>
                {apiState === 'checking'
                  ? 'Checking…'
                  : apiState === 'available'
                    ? 'Recheck API'
                    : 'Retry API'}
              </button>
            </div>
            <PlaidCard />
            <div className="conn connectionCard connectionCard--available on">
              <div className="connectionCardHead">
                <strong>Portfolio CSV</strong>
                <ConnectionBadge state="available" />
              </div>
              <span className="connectionDescription">
                Import holdings, dated activity, and account valuations from one file
              </span>
              <button onClick={() => setScreen('portfolio')}>Open Importer</button>
            </div>
            <div
              className={`conn connectionCard connectionCard--${apiState} ${apiState === 'available' ? 'on' : ''}`}
            >
              <div className="connectionCardHead">
                <strong>A2A Agent Card</strong>
                <ConnectionBadge state={apiState} />
              </div>
              <span className="connectionDescription">
                {apiState === 'checking'
                  ? 'Checking whether the discovery document is reachable.'
                  : apiState === 'available'
                    ? 'The API discovery document is ready for compatible A2A clients.'
                    : 'The discovery document is unavailable while the API is offline.'}
              </span>
              <button
                onClick={() =>
                  void openExternal(`${API_URL}/.well-known/agent.json`)
                }
                disabled={apiState !== 'available'}
              >
                View Agent Card
              </button>
            </div>
          </div>
        </div>
      </Panel>
      <Panel>
        <PanelHead
          title="Roadmap"
          subtitle="Planned integrations — shown for visibility, not as live controls."
        />
        <div className="body">
          <div className="connGrid">
            {connections.map((c) => (
              <div className="conn connectionCard connectionCard--planned" key={c.name}>
                <div className="connectionCardHead">
                  <strong>{c.name}</strong>
                  <ConnectionBadge state="planned" />
                </div>
                <span className="connectionDescription">{c.type}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </AppPage>
  )
}
