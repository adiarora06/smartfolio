// Live system status chip — makes the running architecture visible in the UI.
// Green: FastAPI backend reachable (shows provider/model/db from /health).
// Amber: local deterministic mirror; click retries (free-tier server may be waking).

import { useState } from 'react'
import { useStore } from '../../store/useStore'

const dot = (color: string): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: color,
  display: 'inline-block',
  flexShrink: 0,
})

const wrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '10px 12px',
  marginTop: 10,
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.25)',
  fontSize: 11.5,
  lineHeight: 1.45,
  cursor: 'pointer',
  background: 'rgba(148, 163, 184, 0.06)',
  textAlign: 'left',
  width: '100%',
}

export function SystemStatus() {
  const backendOnline = useStore((s) => s.backendOnline)
  const health = useStore((s) => s.health)
  const checkBackend = useStore((s) => s.checkBackend)
  const [checking, setChecking] = useState(false)

  const retry = async () => {
    if (checking) return
    setChecking(true)
    try {
      await checkBackend()
    } finally {
      setChecking(false)
    }
  }

  if (backendOnline === null || checking) {
    return (
      <div style={{ ...wrap, cursor: 'default' }}>
        <span style={{ ...dot('#94a3b8'), marginTop: 4 }} />
        <span style={{ color: 'var(--muted)' }}>
          <strong>Connecting to live engine…</strong>
          <br />
          Free-tier server may take ~30s to wake.
        </span>
      </div>
    )
  }

  if (backendOnline && health) {
    return (
      <button style={{ ...wrap, cursor: 'default' }} title="Live FastAPI backend">
        <span style={{ ...dot('#34d399'), marginTop: 4 }} />
        <span>
          <strong>Live engine v{health.version}</strong>
          <br />
          <span style={{ color: 'var(--muted)' }}>
            {health.liveMarketData ? `${health.marketDataProvider} quotes` : 'offline quotes'}
            {' · '}
            {health.llm ? health.llmModel : 'template AI'}
            {' · '}
            {health.database}
          </span>
        </span>
      </button>
    )
  }

  return (
    <button style={wrap} onClick={() => void retry()} title="Click to reconnect">
      <span style={{ ...dot('#f59e0b'), marginTop: 4 }} />
      <span>
        <strong>Local mirror mode</strong>
        <br />
        <span style={{ color: 'var(--muted)' }}>
          Backend unreachable — tap to reconnect.
        </span>
      </span>
    </button>
  )
}
