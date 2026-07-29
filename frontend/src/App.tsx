// Top-level shell. Routes between the three top-level pages based on store state.
// (A single-source-of-truth `page` value replaces the prototype's show/hide DOM.)

import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { hideSplash } from './lib/native'
import { TopBar } from './components/layout/TopBar'
import { LandingPage } from './components/landing/LandingPage'
import { SetupFlow } from './components/setup/SetupFlow'
import { AppShell } from './components/app/AppShell'

export default function App() {
  const page = useStore((s) => s.page)
  const checkBackend = useStore((s) => s.checkBackend)

  // Dismiss the native launch splash as soon as React has painted. The UI is
  // already interactive at this point because the deterministic engine runs
  // locally — the backend warm-up below only upgrades it.
  useEffect(() => {
    void hideSplash()
  }, [])

  // Detect the FastAPI backend on load; the app runs on the local
  // deterministic mirror when it is unreachable. Free-tier hosts sleep when
  // idle, so retry a few times while the server wakes instead of giving up
  // on the first refused connection.
  useEffect(() => {
    let cancelled = false
    let attempts = 0
    const connect = async () => {
      await checkBackend()
      attempts += 1
      const online = useStore.getState().backendOnline
      if (!cancelled && !online && attempts < 6) setTimeout(() => void connect(), 10000)
    }
    void connect()
    return () => {
      cancelled = true
    }
  }, [checkBackend])

  return (
    <>
      <TopBar />
      <div className="shell">
        {page === 'landing' && <LandingPage />}
        {page === 'setup' && <SetupFlow />}
        {page === 'app' && <AppShell />}
      </div>
    </>
  )
}
