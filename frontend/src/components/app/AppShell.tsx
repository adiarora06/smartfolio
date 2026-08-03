// The authenticated app.
//
// Layout is one Ionic tree serving both form factors:
//   - phone   : IonTabs with a bottom IonTabBar (split-pane collapsed)
//   - desktop : IonSplitPane opens a persistent sidebar; the tab bar is
//               hidden by CSS at the same breakpoint
//
// Navigation is route-based (not store-state-based) because that is what buys
// the native push/pop transitions and the iOS swipe-back gesture. The store's
// `screen` is kept in sync by <ScreenSync /> so existing consumers — active
// highlighting, and setScreen() calls like "Ask Advisor" — keep working.

import { useEffect, useState } from 'react'
import { Redirect, Route, useHistory, useLocation } from 'react-router-dom'
import {
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenu,
  IonRouterOutlet,
  IonSplitPane,
  IonTabBar,
  IonTabButton,
  IonTabs,
  IonTitle,
  IonToolbar,
} from '@ionic/react'
import {
  analyticsOutline,
  ellipsisHorizontal,
  gitNetworkOutline,
  gridOutline,
  linkOutline,
  optionsOutline,
  pieChartOutline,
} from 'ionicons/icons'
import { useStore } from '../../store/useStore'
import { pathFor, registerNavigator, screenFromPath } from '../../lib/nav'
import { OverviewScreen } from './screens/OverviewScreen'
import { PortfolioScreen } from './screens/PortfolioScreen'
import { AnalyzeStockScreen } from './screens/AnalyzeStockScreen'
import { ScenariosScreen } from './screens/ScenariosScreen'
import { ConnectionsScreen } from './screens/ConnectionsScreen'
import { OpenSourceScreen } from './screens/OpenSourceScreen'
import { MoreScreen } from './MoreScreen'

/** Mirrors the router into the store, and hands the store a navigator. */
function ScreenSync() {
  const history = useHistory()
  const location = useLocation()
  const syncScreen = useStore((s) => s.syncScreen)

  useEffect(() => {
    registerNavigator((path) => history.push(path))
  }, [history])

  useEffect(() => {
    const screen = screenFromPath(location.pathname)
    if (screen) syncScreen(screen)
  }, [location.pathname, syncScreen])

  return null
}

const SIDEBAR_ITEMS = [
  { path: pathFor('overview'), icon: gridOutline, label: 'Overview' },
  { path: pathFor('portfolio'), icon: pieChartOutline, label: 'Portfolio' },
  { path: pathFor('stock'), icon: analyticsOutline, label: 'Analyze' },
  { path: pathFor('scenarios'), icon: optionsOutline, label: 'AI Assistant' },
  { path: pathFor('connections'), icon: linkOutline, label: 'Connections' },
  { path: pathFor('opensource'), icon: gitNetworkOutline, label: 'Open Source' },
]

/** True at Ionic's `lg` breakpoint — the same width IonSplitPane opens at. */
function useIsWide(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 992px)').matches,
  )
  useEffect(() => {
    // Same guard as the lazy initializer above — without it, mounting under
    // Node (tests, SSR) throws on window.matchMedia.
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(min-width: 992px)')
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

/** Desktop-only sidebar. Below the split-pane breakpoint the menu is disabled
 *  outright — not merely hidden — so its edge-swipe cannot compete with the
 *  router's swipe-back gesture, and the menu button auto-hides. */
function Sidebar() {
  const location = useLocation()
  const wide = useIsWide()
  return (
    <IonMenu className="desktopSidebar" contentId="main" type="overlay" disabled={!wide}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>
            <span className="sidebarBrandMark" aria-hidden="true">S</span>
            <span>SmartFolio</span>
          </IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonList className="sidebarNav">
          {SIDEBAR_ITEMS.map((it) => (
            <IonItem
              className={location.pathname === it.path ? 'sidebarNavItem active' : 'sidebarNavItem'}
              key={it.path}
              routerLink={it.path}
              routerDirection="root"
              lines="none"
              color={location.pathname === it.path ? 'light' : undefined}
            >
              <IonIcon
                slot="start"
                icon={it.icon}
                color={location.pathname === it.path ? 'primary' : 'medium'}
              />
              <IonLabel>{it.label}</IonLabel>
            </IonItem>
          ))}
        </IonList>
        <div className="sidebarStatus">
          <span className="sidebarStatusDot" aria-hidden="true" />
          <span>
            <strong>Workspace ready</strong>
            <small>Local-first analysis</small>
          </span>
        </div>
      </IonContent>
    </IonMenu>
  )
}

export function AppShell() {
  return (
    <>
      <ScreenSync />
      <IonSplitPane contentId="main" when="lg">
        <Sidebar />
        {/* The split-pane's content must be a DIRECT child it can size. The
            outlet is nested inside ion-tabs (and IonTabs takes no id), so this
            wrapper carries the contentId; without it the pane has nothing to
            size and the sidebar never gets its column. */}
        <div id="main" className="splitMain">
        <IonTabs>
          <IonRouterOutlet>
            <Route exact path="/overview" component={OverviewScreen} />
            <Route exact path="/portfolio" component={PortfolioScreen} />
            <Route exact path="/stock" component={AnalyzeStockScreen} />
            <Route exact path="/scenarios" component={ScenariosScreen} />
            <Route exact path="/advisor">
              <Redirect to="/scenarios?focus=advisor" />
            </Route>
            <Route exact path="/connections" component={ConnectionsScreen} />
            <Route exact path="/opensource" component={OpenSourceScreen} />
            <Route exact path="/more" component={MoreScreen} />
            <Redirect exact from="/" to="/overview" />
          </IonRouterOutlet>

          <IonTabBar slot="bottom">
            <IonTabButton tab="overview" href={pathFor('overview')}>
              <IonIcon icon={gridOutline} />
              <IonLabel>Home</IonLabel>
            </IonTabButton>
            <IonTabButton tab="portfolio" href={pathFor('portfolio')}>
              <IonIcon icon={pieChartOutline} />
              <IonLabel>Portfolio</IonLabel>
            </IonTabButton>
            <IonTabButton tab="stock" href={pathFor('stock')}>
              <IonIcon icon={analyticsOutline} />
              <IonLabel>Analyze</IonLabel>
            </IonTabButton>
            <IonTabButton tab="advisor" href={pathFor('scenarios')}>
              <IonIcon icon={optionsOutline} />
              <IonLabel>AI Assistant</IonLabel>
            </IonTabButton>
            <IonTabButton tab="more" href="/more">
              <IonIcon icon={ellipsisHorizontal} />
              <IonLabel>More</IonLabel>
            </IonTabButton>
          </IonTabBar>
        </IonTabs>
        </div>
      </IonSplitPane>
    </>
  )
}
