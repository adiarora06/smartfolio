// Navigation plumbing.
//
// Ionic's push/pop transitions and the iOS swipe-back gesture require real
// routes, but the store already exposes setScreen() and a dozen call sites use
// it (e.g. "Ask Advisor" jumping from the stock terminal). Rather than rewrite
// those, the router becomes the source of truth and the store's `screen` is
// kept in sync with the URL:
//
//   setScreen(s)  ->  navigateTo(s)  ->  route change  ->  ScreenSync updates
//
// A module-level registry is used because the store is created outside React
// and cannot call useHistory().

import type { Screen } from '../types'

export const SCREENS: Screen[] = [
  'overview',
  'portfolio',
  'stock',
  'scenarios',
  'advisor',
  'connections',
  'opensource',
]

/** Tabs shown in the bottom bar; the rest live behind "More". */
export const PRIMARY_TABS: Screen[] = ['overview', 'portfolio', 'stock', 'advisor']

export const SECONDARY_SCREENS: Screen[] = ['scenarios', 'connections', 'opensource']

export const pathFor = (screen: Screen): string => `/${screen}`

export const screenFromPath = (pathname: string): Screen | null => {
  const seg = pathname.split('/')[1] as Screen
  return SCREENS.includes(seg) ? seg : null
}

type NavigateFn = (path: string) => void

let navigate: NavigateFn | null = null

/** Called once by the app shell with the router's push function. */
export function registerNavigator(fn: NavigateFn): void {
  navigate = fn
}

/** No-op before the router mounts (e.g. landing page), which is intended. */
export function navigateTo(screen: Screen): void {
  navigate?.(pathFor(screen))
}
