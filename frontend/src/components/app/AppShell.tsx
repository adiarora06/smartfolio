// The authenticated app: sidebar (nav + agents + disclaimer) and the active screen.

import { useStore } from '../../store/useStore'
import { Disclaimer } from '../layout/Disclaimer'
import { SideNav } from './SideNav'
import { AgentPanel } from './AgentPanel'
import { OverviewScreen } from './screens/OverviewScreen'
import { PortfolioScreen } from './screens/PortfolioScreen'
import { AnalyzeStockScreen } from './screens/AnalyzeStockScreen'
import { ScenariosScreen } from './screens/ScenariosScreen'
import { AdvisorScreen } from './screens/AdvisorScreen'
import { ConnectionsScreen } from './screens/ConnectionsScreen'

export function AppShell() {
  const screen = useStore((s) => s.screen)
  return (
    <section className="page active" id="app">
      <div className="appShell">
        <aside>
          <SideNav />
          <AgentPanel />
          <Disclaimer />
        </aside>
        <main>
          {screen === 'overview' && <OverviewScreen />}
          {screen === 'portfolio' && <PortfolioScreen />}
          {screen === 'stock' && <AnalyzeStockScreen />}
          {screen === 'scenarios' && <ScenariosScreen />}
          {screen === 'advisor' && <AdvisorScreen />}
          {screen === 'connections' && <ConnectionsScreen />}
        </main>
      </div>
    </section>
  )
}
