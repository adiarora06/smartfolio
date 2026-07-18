// Global app state (Zustand).
//
// The store holds INPUTS and UI state only (profile, holdings, connections,
// chat, saved memos, the current forecast snapshot). Derived portfolio
// analysis is NOT stored — it is computed from inputs by the deterministic
// engine via usePortfolioAnalysis(). This keeps a single source of truth and
// mirrors the "state in, calculations derived" backend design.

import { create } from 'zustand'
import type {
  ChatMessage,
  Connection,
  Holding,
  InvestorProfile,
  Page,
  SavedMemo,
  Screen,
  StockForecast,
  StockTab,
} from '../types'
import {
  DEFAULT_PROFILE,
  SETUP_STEPS,
  defaultConnections,
  demoHoldings,
  initialChat,
} from '../lib/data/constants'
import { analyzePortfolio } from '../lib/calculations/portfolio'
import { analyzeStock } from '../lib/calculations/stock'
import { buildSavedMemo } from '../lib/ai/memo'
import { answerAdvisor } from '../lib/ai/advisor'
import { apiAnalyzeStock, apiAskAdvisor, apiHealth } from '../lib/api/client'

/** Where the last analysis/answer came from: the FastAPI backend or the local mirror. */
export type EngineSource = 'api' | 'local'

interface AppState {
  // navigation / UI
  page: Page
  screen: Screen
  setupStep: number
  stockTab: StockTab

  // domain inputs
  profile: InvestorProfile
  holdings: Holding[]
  connections: Connection[]
  chat: ChatMessage[]
  stockMemory: SavedMemo[]
  /** Snapshot of the last stock analysis run (deterministic output). */
  stock: StockForecast
  /** Which engine produced the current stock snapshot. */
  stockSource: EngineSource
  /** Last known backend health (null = not checked yet). */
  backendOnline: boolean | null

  // backend
  checkBackend: () => Promise<void>

  // navigation actions
  goToPage: (page: Page) => void
  openDemo: () => void
  setScreen: (screen: Screen) => void
  setStockTab: (tab: StockTab) => void
  nextSetupStep: () => void
  prevSetupStep: () => void

  // profile / onboarding
  updateProfile: (patch: Partial<InvestorProfile>) => void

  // holdings
  addHolding: () => void
  removeHolding: (index: number) => void
  updateHolding: <K extends keyof Holding>(index: number, field: K, value: Holding[K]) => void
  resetHoldings: () => void

  // analyze stock
  runStock: (ticker: string, days: number) => Promise<void>
  resetStock: () => void
  addStockToPortfolio: () => void
  saveMemo: () => void

  // connections
  toggleConnection: (index: number) => void

  // advisor
  ask: (text: string) => Promise<void>
}

export const useStore = create<AppState>((set, get) => ({
  page: 'landing',
  screen: 'overview',
  setupStep: 0,
  stockTab: 'forecast',

  profile: { ...DEFAULT_PROFILE },
  holdings: demoHoldings(),
  connections: defaultConnections(),
  chat: initialChat(),
  stockMemory: [],
  stock: analyzeStock('AAPL', 30),
  stockSource: 'local',
  backendOnline: null,

  checkBackend: async () => {
    try {
      await apiHealth()
      set({ backendOnline: true })
      // Hydrate the initial forecast from the canonical engine if the user
      // hasn't run an API-backed analysis yet.
      const { stockSource, stock } = get()
      if (stockSource === 'local') await get().runStock(stock.symbol, stock.days)
    } catch {
      set({ backendOnline: false })
    }
  },

  goToPage: (page) => set({ page }),
  openDemo: () => set({ page: 'app', screen: 'overview' }),
  setScreen: (screen) => set({ screen }),
  setStockTab: (stockTab) => set({ stockTab }),
  nextSetupStep: () =>
    set((s) =>
      s.setupStep === SETUP_STEPS.length - 1
        ? { page: 'app', screen: 'overview' }
        : { setupStep: s.setupStep + 1 },
    ),
  prevSetupStep: () => set((s) => ({ setupStep: Math.max(0, s.setupStep - 1) })),

  updateProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),

  addHolding: () =>
    set((s) => ({
      holdings: [
        ...s.holdings,
        { symbol: '', name: '', type: 'stock', asset: 'us_equity', sector: 'technology', value: 0 },
      ],
    })),
  removeHolding: (index) => set((s) => ({ holdings: s.holdings.filter((_, i) => i !== index) })),
  updateHolding: (index, field, value) =>
    set((s) => ({
      holdings: s.holdings.map((h, i) => (i === index ? { ...h, [field]: value } : h)),
    })),
  resetHoldings: () => set({ holdings: demoHoldings() }),

  runStock: async (ticker, days) => {
    // Backend first (canonical engine); fall back to the local mirror offline.
    try {
      const stock = await apiAnalyzeStock(ticker, days)
      set({ stock, stockSource: 'api', stockTab: 'forecast', backendOnline: true })
    } catch {
      set({
        stock: analyzeStock(ticker, days),
        stockSource: 'local',
        stockTab: 'forecast',
        backendOnline: false,
      })
    }
  },
  resetStock: () => {
    void get().runStock('AAPL', 30)
  },
  addStockToPortfolio: () =>
    set((s) => ({
      holdings: [
        ...s.holdings,
        {
          symbol: s.stock.symbol,
          name: s.stock.name,
          type: 'stock',
          asset: 'us_equity',
          sector: s.stock.sector,
          value: Math.round(s.stock.price * 10),
        },
      ],
      screen: 'portfolio',
    })),
  saveMemo: () =>
    set((s) => ({
      stockMemory: [
        { symbol: s.stock.symbol, rating: s.stock.rating, memo: buildSavedMemo(s.stock) },
        ...s.stockMemory,
      ].slice(0, 8),
      stockTab: 'memory',
    })),

  toggleConnection: (index) =>
    set((s) => ({
      connections: s.connections.map((c, i) => (i === index ? { ...c, on: !c.on } : c)),
    })),

  ask: async (text) => {
    const q = text.trim()
    if (!q) return
    const { holdings, profile, stock } = get()
    // Show the user's message immediately; the answer follows.
    set((s) => ({ chat: [...s.chat, { role: 'user', text: q }] }))
    let reply: string
    try {
      reply = (await apiAskAdvisor(q, profile, holdings, stock)).answer
      set({ backendOnline: true })
    } catch {
      const analysis = analyzePortfolio(holdings, profile)
      reply = answerAdvisor(q, { analysis, stock })
      set({ backendOnline: false })
    }
    set((s) => ({ chat: [...s.chat, { role: 'ai', text: reply }] }))
  },
}))
