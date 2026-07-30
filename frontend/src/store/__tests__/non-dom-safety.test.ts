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
})
