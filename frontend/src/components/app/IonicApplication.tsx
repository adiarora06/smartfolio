import { IonApp, setupIonicReact } from '@ionic/react'
import { IonReactRouter } from '@ionic/react-router'
import { AppShell } from './AppShell'

// Ionic's own stylesheets must load before our overrides so the SmartFolio
// theme wins. Keeping them behind this module also defers the native-style
// workspace CSS until someone enters the application.
import '@ionic/react/css/core.css'
import '@ionic/react/css/normalize.css'
import '@ionic/react/css/structure.css'
import '@ionic/react/css/typography.css'
import '@ionic/react/css/padding.css'
import '@ionic/react/css/flex-utils.css'
import '../../theme/ionic.css'

// Use one presentation mode across browsers and operating systems. This
// module is evaluated once, when the deferred Ionic workspace first loads.
setupIonicReact({ mode: 'ios' })

export function IonicApplication() {
  return (
    <IonApp>
      <IonReactRouter>
        <AppShell />
      </IonReactRouter>
    </IonApp>
  )
}
