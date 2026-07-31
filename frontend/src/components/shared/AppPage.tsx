// The app-screen frame.
//
// Every routed screen renders one of these. IonRouterOutlet requires an
// IonPage at the root of each route — that is what makes the sliding push/pop
// transition and the iOS edge swipe work — and IonContent gives momentum
// scrolling plus automatic safe-area insets.
//
// The nav bar owns the screen title, so screens no longer render <AppHero>:
// the title appears twice otherwise. The large title collapses into the
// compact toolbar on scroll, which is the signature iOS header behavior.

import type { ReactNode } from 'react'
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonMenuButton,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonTitle,
  IonToolbar,
  type RefresherEventDetail,
} from '@ionic/react'

export function AppPage({
  title,
  subtitle,
  actions,
  onRefresh,
  largeTitle = true,
  headerAction,
  children,
}: {
  title: string
  subtitle?: ReactNode
  /** Buttons rendered under the title (Run Analysis, Save Memo, …). */
  actions?: ReactNode
  /** Enables pull-to-refresh when provided. */
  onRefresh?: () => Promise<void>
  /** Disable the collapsing title for compact top-level app screens. */
  largeTitle?: boolean
  /** Optional trailing toolbar control, such as a profile button. */
  headerAction?: ReactNode
  children: ReactNode
}) {
  const handleRefresh = async (e: CustomEvent<RefresherEventDetail>) => {
    try {
      await onRefresh?.()
    } finally {
      e.detail.complete()
    }
  }

  return (
    <IonPage>
      <IonHeader translucent>
        <IonToolbar>
          <IonButtons slot="start">
            {/* No defaultHref on purpose: the back button then renders only
                when this page was pushed onto a stack (e.g. More -> Scenarios)
                and stays absent on the four top-level tabs. */}
            <IonBackButton />
            {/* Only rendered when the split-pane sidebar is collapsed. */}
            <IonMenuButton autoHide />
          </IonButtons>
          <IonTitle>{title}</IonTitle>
          {headerAction && <IonButtons slot="end">{headerAction}</IonButtons>}
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        {largeTitle && (
          <IonHeader collapse="condense">
            <IonToolbar>
              <IonTitle size="large">{title}</IonTitle>
            </IonToolbar>
          </IonHeader>
        )}

        {onRefresh && (
          <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
            <IonRefresherContent />
          </IonRefresher>
        )}

        {(subtitle || actions) && (
          <div className="pageIntro">
            {subtitle && <p className="pageSubtitle">{subtitle}</p>}
            {actions && <div className="pageActions">{actions}</div>}
          </div>
        )}

        {children}
      </IonContent>
    </IonPage>
  )
}
