// The store is created at module scope, so anything it touches at import time
// runs under Node too (Vitest here, and SSR if the web build ever adopts it).
// It previously read window.location.pathname unguarded, which threw on
// import. This test fails with "window is not defined" if that regresses.

import { describe, expect, it } from 'vitest'

describe('store imports without a DOM', () => {
  it('does not touch window at module scope', async () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined')

    const { useStore } = await import('../useStore')

    // With no DOM there is no path to deep-link into, so it opens on landing.
    expect(useStore.getState().page).toBe('landing')
  })

  it('creates and mutates holdings by stable id', async () => {
    const { useStore } = await import('../useStore')
    const id = useStore.getState().addHolding()

    expect(useStore.getState().holdings.some((holding) => holding.id === id)).toBe(true)
    useStore.getState().updateHolding(id, 'quantity', 2)
    useStore.getState().updateHolding(id, 'currentPrice', 125)
    expect(useStore.getState().holdings.find((holding) => holding.id === id)?.value).toBe(250)

    useStore.getState().removeHolding(id)
    expect(useStore.getState().holdings.some((holding) => holding.id === id)).toBe(false)
  })
})
