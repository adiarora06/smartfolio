/// <reference types="@capacitor/cli" />
import type { CapacitorConfig } from '@capacitor/cli'

// Native shell config. The web build in `dist/` is bundled into the app, so
// the app runs fully offline against the deterministic engine in
// lib/calculations and upgrades to the live API when it can reach it.
const config: CapacitorConfig = {
  appId: 'com.adiarora.smartfolio',
  appName: 'SmartFolio',
  webDir: 'dist',
  ios: {
    // Ionic already applies the status-bar safe area to its toolbars. Asking
    // WKWebView to inset as well doubles the top gap on current iOS runtimes.
    contentInset: 'never',
    // Avoid the rubber-band overscroll that makes a webview feel like a page.
    scrollEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#0b1220',
      showSpinner: false,
      launchAutoHide: true,
    },
  },
}

export default config
