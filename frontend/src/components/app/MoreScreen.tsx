// "More" tab — the iOS convention for overflow navigation.
//
// A tab bar holds five items, so the three system/secondary screens live here
// as pushable list rows with chevrons. This replaces the custom bottom sheet:
// tapping a row performs a real route push, so it gets the sliding transition
// and the swipe-back gesture for free.

import {
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonPage,
  IonTitle,
  IonToolbar,
} from '@ionic/react'
import {
  cloudOfflineOutline,
  cloudDoneOutline,
  gitNetworkOutline,
  homeOutline,
  linkOutline,
  optionsOutline,
} from 'ionicons/icons'
import { useStore } from '../../store/useStore'
import { pathFor } from '../../lib/nav'

const ROWS = [
  {
    path: pathFor('scenarios'),
    icon: optionsOutline,
    label: 'Scenarios',
    note: 'Project contributions and returns',
  },
  {
    path: pathFor('connections'),
    icon: linkOutline,
    label: 'Connections',
    note: 'Brokerage sync, agent card, data sources',
  },
  {
    path: pathFor('opensource'),
    icon: gitNetworkOutline,
    label: 'Open Source',
    note: 'Agent pipeline and design rules',
  },
]

export function MoreScreen() {
  const health = useStore((s) => s.health)
  const backendOnline = useStore((s) => s.backendOnline)
  const goToPage = useStore((s) => s.goToPage)

  return (
    <IonPage>
      <IonHeader translucent>
        <IonToolbar>
          <IonTitle>More</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        {/* Collapsing large title: the small one above swaps in on scroll. */}
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">More</IonTitle>
          </IonToolbar>
        </IonHeader>

        <IonList inset>
          {ROWS.map((r) => (
            <IonItem key={r.path} routerLink={r.path} detail>
              <IonIcon slot="start" icon={r.icon} color="primary" />
              <IonLabel>
                <h2>{r.label}</h2>
                <p>{r.note}</p>
              </IonLabel>
            </IonItem>
          ))}
        </IonList>

        <IonListHeader>Engine</IonListHeader>
        <IonList inset>
          <IonItem>
            <IonIcon
              slot="start"
              icon={backendOnline ? cloudDoneOutline : cloudOfflineOutline}
              color={backendOnline ? 'success' : 'warning'}
            />
            <IonLabel>
              <h2>{backendOnline ? 'Live engine' : 'Local mirror'}</h2>
              <p>
                {backendOnline && health
                  ? `v${health.version} · ${
                      health.liveMarketData ? health.marketDataProvider : 'offline'
                    } · ${health.llm ? health.llmModel : 'template'} · ${health.database}`
                  : 'Analysis runs on-device. Reconnects automatically.'}
              </p>
            </IonLabel>
          </IonItem>
        </IonList>

        <IonList inset>
          <IonItem button detail onClick={() => goToPage('landing')}>
            <IonIcon slot="start" icon={homeOutline} />
            <IonLabel>Home</IonLabel>
          </IonItem>
        </IonList>

        <IonNote className="disclaimerNote">
          Educational analysis only — not financial advice. SmartFolio does not
          execute trades.
        </IonNote>
      </IonContent>
    </IonPage>
  )
}
