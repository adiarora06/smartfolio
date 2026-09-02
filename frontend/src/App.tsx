// Top-level shell.
//
// `page` still switches between the three top-level surfaces, because landing
// and setup are marketing/onboarding flows rather than app screens — they want
// page scroll, not an IonPage with a nav bar. Everything under `app` is Ionic
// and route-driven (see AppShell).

import { useEffect } from 'react'
import { IonApp } from '@ionic/react'
import { IonReactRouter } from '@ionic/react-router'
import { useStore } from './store/useStore'
import { TopBar } from './components/layout/TopBar'
import { LandingPage } from './components/landing/LandingPage'
import { SetupFlow } from './components/setup/SetupFlow'
import { AppShell } from './components/app/AppShell'

export default function App() {
  const page = useStore((s) => s.page)
  const checkBackend = useStore((s) => s.checkBackend)

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
    <IonApp>
      <IonReactRouter>
        {page === 'app' ? (
          <AppShell />
        ) : (
          // Marketing surfaces keep the plain document flow and the web top bar.
          <div className="webSurface">
            <TopBar />
            <div className="shell">
              {page === 'landing' && <LandingPage />}
              {page === 'setup' && <SetupFlow />}
            </div>
          </div>
        )}
      </IonReactRouter>
    </IonApp>
  )
}
