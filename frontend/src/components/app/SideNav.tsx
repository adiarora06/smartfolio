// Left-hand screen navigation inside the app.

import { useStore } from '../../store/useStore'
import type { Screen } from '../../types'

const NAV_ITEMS: Array<[Screen, string]> = [
  ['overview', 'Overview'],
  ['portfolio', 'Portfolio'],
  ['stock', 'Analyze Stock'],
  ['scenarios', 'Scenarios'],
  ['advisor', 'AI Advisor'],
  ['connections', 'Connections'],
]

export function SideNav() {
  const screen = useStore((s) => s.screen)
  const setScreen = useStore((s) => s.setScreen)
  return (
    <section className="panel">
      <nav className="nav">
        {NAV_ITEMS.map(([id, label]) => (
          <button
            key={id}
            className={screen === id ? 'active' : undefined}
            onClick={() => setScreen(id)}
          >
            {label}
          </button>
        ))}
      </nav>
    </section>
  )
}
