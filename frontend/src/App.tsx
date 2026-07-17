// Top-level shell. Routes between the three top-level pages based on store state.
// (A single-source-of-truth `page` value replaces the prototype's show/hide DOM.)

import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { TopBar } from './components/layout/TopBar'
import { LandingPage } from './components/landing/LandingPage'
import { SetupFlow } from './components/setup/SetupFlow'
import { AppShell } from './components/app/AppShell'

export default function App() {
  const page = useStore((s) => s.page)
  const checkBackend = useStore((s) => s.checkBackend)

  // Detect the FastAPI backend once on load; the app runs on the local
  // deterministic mirror when it is unreachable.
  useEffect(() => {
    void checkBackend()
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
