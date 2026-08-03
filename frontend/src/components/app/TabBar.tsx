// Bottom tab bar — the phone navigation, replacing the desktop sidebar.
//
// iOS convention caps a tab bar at five items, so the three system/secondary
// screens (Scenarios, Connections, Open Source) live behind "More", together
// with the backend status chip and the disclaimer that used to sit in the
// sidebar. Visible only under 720px (see the mobile layer in styles/index.css);
// the sidebar still owns navigation on desktop.

import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { Disclaimer } from '../layout/Disclaimer'
import { SystemStatus } from './SystemStatus'
import type { Screen } from '../../types'

type IconProps = { d: string }
const Icon = ({ d }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const PATHS = {
  overview: 'M4 13h6V4H4v9Zm10 7h6v-9h-6v9ZM4 20h6v-4H4v4ZM14 8h6V4h-6v4Z',
  portfolio: 'M12 3v9h9a9 9 0 1 1-9-9Z',
  stock: 'M4 19V5m0 14h16M8 15l3.5-4 3 2.5L20 7',
  advisor: 'M21 12a8 8 0 0 1-8 8H8l-4 3v-5.5A8 8 0 1 1 21 12Z',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
} as const

// The four primary tabs; "More" is handled separately.
const PRIMARY: Array<[Screen, string, string]> = [
  ['overview', 'Overview', PATHS.overview],
  ['portfolio', 'Portfolio', PATHS.portfolio],
  ['stock', 'Analyze', PATHS.stock],
  ['advisor', 'Advisor', PATHS.advisor],
]

const SECONDARY: Array<[Screen, string]> = [
  ['scenarios', 'Scenarios'],
  ['connections', 'Connections'],
  ['opensource', 'Open Source'],
]

export function TabBar() {
  const screen = useStore((s) => s.screen)
  const setScreen = useStore((s) => s.setScreen)
  const goToPage = useStore((s) => s.goToPage)
  const [moreOpen, setMoreOpen] = useState(false)

  const inMore = SECONDARY.some(([id]) => id === screen)

  const go = (id: Screen) => {
    setScreen(id)
    setMoreOpen(false)
  }

  return (
    <>
      {moreOpen && (
        <div
          className="sheetScrim"
          onClick={() => setMoreOpen(false)}
          role="presentation"
        />
      )}
      {moreOpen && (
        <div className="sheet" role="dialog" aria-label="More">
          <div className="sheetGrip" />
          <div className="sheetBody">
            {SECONDARY.map(([id, label]) => (
              <button
                key={id}
                className={screen === id ? 'active' : undefined}
                onClick={() => go(id)}
              >
                {label}
              </button>
            ))}
            {/* The compact in-app header drops the landing links on phones, so
                this is the way back out. */}
            <button
              onClick={() => {
                setMoreOpen(false)
                goToPage('landing')
              }}
            >
              Home
            </button>
            <SystemStatus />
            <Disclaimer />
          </div>
        </div>
      )}

      <nav className="tabbar" aria-label="Main">
        {PRIMARY.map(([id, label, d]) => (
          <button
            key={id}
            className={screen === id && !moreOpen ? 'active' : undefined}
            aria-current={screen === id ? 'page' : undefined}
            onClick={() => go(id)}
          >
            <Icon d={d} />
            {label}
          </button>
        ))}
        <button
          className={moreOpen || inMore ? 'active' : undefined}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          <Icon d={PATHS.more} />
          More
        </button>
      </nav>
    </>
  )
}
