// The authenticated app: sidebar (nav + disclaimer) and the active screen.
// System internals (agent network, graph, pipeline) live in the Open Source
// screen — not in the customer-facing sidebar.

import { useStore } from '../../store/useStore'
import { Disclaimer } from '../layout/Disclaimer'
import { SideNav } from './SideNav'
import { SystemStatus } from './SystemStatus'
import { OverviewScreen } from './screens/OverviewScreen'
import { PortfolioScreen } from './screens/PortfolioScreen'
import { AnalyzeStockScreen } from './screens/AnalyzeStockScreen'
import { ScenariosScreen } from './screens/ScenariosScreen'
import { AdvisorScreen } from './screens/AdvisorScreen'
import { ConnectionsScreen } from './screens/ConnectionsScreen'
import { OpenSourceScreen } from './screens/OpenSourceScreen'

export function AppShell() {
  const screen = useStore((s) => s.screen)
  return (
    <section className="page active" id="app">
      <div className="appShell">
        <aside>
          <SideNav />
          <SystemStatus />
          <Disclaimer />
        </aside>
        <main>
          {screen === 'overview' && <OverviewScreen />}
          {screen === 'portfolio' && <PortfolioScreen />}
          {screen === 'stock' && <AnalyzeStockScreen />}
          {screen === 'scenarios' && <ScenariosScreen />}
          {screen === 'advisor' && <AdvisorScreen />}
          {screen === 'connections' && <ConnectionsScreen />}
          {screen === 'opensource' && <OpenSourceScreen />}
        </main>
      </div>
    </section>
  )
}
