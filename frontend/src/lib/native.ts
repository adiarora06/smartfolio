// Native bridge — one place where the app talks to the device.
//
// Every function degrades to a web equivalent, so the same build serves the
// browser and the iOS app. `isNative` gates behavior that only makes sense in
// the native shell (haptics, the share sheet, status-bar styling).
//
// Why this file exists at all: a Capacitor app that only renders the website
// is rejected under App Store Guideline 4.2 (minimum functionality). These are
// the capabilities that make the binary worth installing — and two of them
// (share, external links) fix behavior that is genuinely broken in an iOS
// webview rather than merely adding polish.

import { Capacitor } from '@capacitor/core'

export const isNative = Capacitor.isNativePlatform()

/** Light tap — for committing an action (running an analysis, saving). */
export async function tapFeedback(): Promise<void> {
  if (!isNative) return
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    // Haptics are a nicety; never let them surface an error.
  }
}

/** Success notification — for a completed pipeline run. */
export async function successFeedback(): Promise<void> {
  if (!isNative) return
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics')
    await Haptics.notification({ type: NotificationType.Success })
  } catch {
    /* ignore */
  }
}

/**
 * Share text content.
 *
 * On iOS this opens the system share sheet. In the browser it falls back to
 * the Web Share API, then to a download. The download path is exactly what is
 * broken on iOS Safari — `a.download` is ignored there — which is why the
 * native sheet is a bug fix, not a feature.
 */
export async function shareText(opts: {
  title: string
  text: string
  filename: string
}): Promise<'native' | 'web-share' | 'download'> {
  if (isNative) {
    const { Share } = await import('@capacitor/share')
    await Share.share({ title: opts.title, text: opts.text, dialogTitle: opts.title })
    return 'native'
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: opts.title, text: opts.text })
      return 'web-share'
    } catch {
      // User dismissed, or the browser refused — fall through to download.
    }
  }

  const blob = new Blob([opts.text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.filename
  a.click()
  URL.revokeObjectURL(url)
  return 'download'
}

/**
 * Open an external URL.
 *
 * `window.open` in a Capacitor webview either does nothing or strands the user
 * on a page with no way back. The in-app browser gives them a Done button.
 */
export async function openExternal(url: string): Promise<void> {
  if (isNative) {
    try {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url })
      return
    } catch {
      // Fall through to the web behavior.
    }
  }
  window.open(url, '_blank', 'noopener')
}

/** Hide the launch splash once React has painted. */
export async function hideSplash(): Promise<void> {
  if (!isNative) return
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch {
    /* ignore */
  }
}
