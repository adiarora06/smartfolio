import React from 'react'
import ReactDOM from 'react-dom/client'
import { setupIonicReact } from '@ionic/react'
import App from './App'

// Ionic's own stylesheets must load before ours so our overrides win.
import '@ionic/react/css/core.css'
import '@ionic/react/css/normalize.css'
import '@ionic/react/css/structure.css'
import '@ionic/react/css/typography.css'
import '@ionic/react/css/padding.css'
import '@ionic/react/css/flex-utils.css'

import './theme/ionic.css'
import './styles/index.css'

// Force iOS presentation everywhere, including desktop web and Android.
// Left on 'auto', Ionic renders Material styling off-iOS, so the browser demo
// would not match the app. Committing to one language keeps the codebase and
// the screenshots honest about what the product looks like.
setupIonicReact({ mode: 'ios' })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
