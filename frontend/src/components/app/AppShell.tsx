// The authenticated app: sidebar (nav + disclaimer) and the active screen.
// System internals (agent network, graph, pipeline) live in the Open Source
// screen — not in the customer-facing sidebar.
//
// Responsive navigation: the sidebar drives desktop, and under 720px it is
// hidden in favor of <TabBar /> (a fixed bottom tab bar). Both read the same
// `screen` value from the store, so neither owns navigation state.

import { useStore } from '../../store/useStore'
import { Disclaimer } from '../layout/Disclaimer'
import { SideNav } from './SideNav'
import { SystemStatus } from './SystemStatus'
import { TabBar } from './TabBar'
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
      <TabBar />
    </section>
  )
}
