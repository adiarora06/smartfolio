// Global app state (Zustand).
//
// The store holds INPUTS and UI state only (profile, holdings, connections,
// chat, saved memos, the current analysis snapshot). Derived portfolio
// analysis is NOT stored — it is computed from inputs by the deterministic
// engine via usePortfolioAnalysis().
//
// Persistence model (hybrid, offline-first):
// - localStorage always mirrors profile/holdings/memos, so reloads keep state
//   even with no backend.
// - When the backend is up, an anonymous workspace id (also in localStorage)
//   hydrates server state on load and receives debounced saves on change.

import { create } from 'zustand'
import type {
  AgentEvent,
  ChatMessage,
  Connection,
  Holding,
  InvestorProfile,
  Narrator,
  Page,
  PortfolioImpact,
  SavedMemo,
  Screen,
  StockForecast,
  StockRating,
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
import { computeImpact } from '../lib/calculations/impact'
import { buildSavedMemo } from '../lib/ai/memo'
import { answerAdvisor } from '../lib/ai/advisor'
import {
  apiAnalyzeStock,
  apiAskAdvisor,
  apiCreateWorkspace,
  apiGetAnalysis,
  apiGetWorkspaceState,
  apiHealth,
  apiListAnalyses,
  apiPostMemo,
  apiPutHoldings,
  apiPutProfile,
  type AnalysisSummary,
  type HealthResponse,
} from '../lib/api/client'

/** Where the last analysis/answer came from: the FastAPI backend or the local mirror. */
export type EngineSource = 'api' | 'local'

const LS_STATE_KEY = 'smartfolio.state.v1'
const LS_WORKSPACE_KEY = 'smartfolio.workspaceId'

interface LocalSnapshot {
  profile?: InvestorProfile
  holdings?: Holding[]
  stockMemory?: SavedMemo[]
}

function loadLocalSnapshot(): LocalSnapshot {
  try {
    const raw = localStorage.getItem(LS_STATE_KEY)
    return raw ? (JSON.parse(raw) as LocalSnapshot) : {}
  } catch {
    return {}
  }
}

// Guard: while hydrating from the server we suppress the echo-push.
let suppressSync = false

interface AppState {
  // navigation / UI
  page: Page
  screen: Screen
  setupStep: number
  stockTab: StockTab
  /** A stock analysis run is in flight. */
  running: boolean
  /** An advisor answer is in flight. */
  advisorPending: boolean

  // domain inputs
  profile: InvestorProfile
  holdings: Holding[]
  connections: Connection[]
  chat: ChatMessage[]
  stockMemory: SavedMemo[]

  // current analysis snapshot
  stock: StockForecast
  impact: PortfolioImpact | null
  /** Real pipeline trace from the backend; null in local mode. */
  agentEvents: AgentEvent[] | null
  /** Server-narrated memo lines; null in local mode. */
  serverMemo: string[] | null
  narrator: Narrator | null
  stockSource: EngineSource

  // backend
  backendOnline: boolean | null
  /** Live /health payload — powers the system status chip. */
  health: HealthResponse | null
  workspaceId: string | null
  checkBackend: () => Promise<void>

  // analysis history (persisted runs from the workspace)
  history: AnalysisSummary[]
  refreshHistory: () => Promise<void>
  loadStoredRun: (analysisId: string) => Promise<void>

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
  runStock: (ticker: string, days: number, opts?: { persist?: boolean }) => Promise<void>
  resetStock: () => void
  addStockToPortfolio: () => void
  saveMemo: () => void

  // connections
  toggleConnection: (index: number) => void
  /** Replace holdings with a brokerage import (Plaid) and show the result. */
  importHoldings: (holdings: Holding[]) => void

  // advisor
  ask: (text: string) => Promise<void>
}

const local = loadLocalSnapshot()
const initialProfile = local.profile ?? { ...DEFAULT_PROFILE }
const initialHoldings = local.holdings?.length ? local.holdings : demoHoldings()
const initialStock = analyzeStock('AAPL', 30)

export const useStore = create<AppState>((set, get) => ({
  page: 'landing',
  screen: 'overview',
  setupStep: 0,
  stockTab: 'forecast',
  running: false,
  advisorPending: false,

  profile: initialProfile,
  holdings: initialHoldings,
  connections: defaultConnections(),
  chat: initialChat(),
  stockMemory: local.stockMemory ?? [],

  stock: initialStock,
  impact: computeImpact(initialStock, initialHoldings, initialProfile),
  agentEvents: null,
  serverMemo: null,
  narrator: null,
  stockSource: 'local',

  backendOnline: null,
  health: null,
  workspaceId: null,
  history: [],

  refreshHistory: async () => {
    const { workspaceId, backendOnline } = get()
    if (!workspaceId || !backendOnline) return
    try {
      set({ history: await apiListAnalyses(workspaceId) })
    } catch {
      // History is a nice-to-have — never surface an error for it.
    }
  },

  loadStoredRun: async (analysisId) => {
    try {
      const r = await apiGetAnalysis(analysisId)
      set({
        stock: r.forecast,
        impact: r.impact,
        agentEvents: r.events,
        serverMemo: r.memo,
        narrator: r.narrator,
        stockSource: 'api',
        stockTab: 'forecast',
      })
    } catch {
      // Stored run gone (e.g. wiped DB) — refresh the list so it disappears.
      void get().refreshHistory()
    }
  },

  checkBackend: async () => {
    try {
      // Long timeout: a sleeping free-tier server takes ~30-60s to wake.
      const health = await apiHealth({ timeoutMs: 60000 })
      set({ backendOnline: true, health })
      await bootstrapWorkspace(set, get)
      void get().refreshHistory()
      // Hydrate the initial forecast from the canonical engine if the user
      // hasn't run an API-backed analysis yet. Not persisted — only
      // user-initiated runs belong in the workspace history.
      const { stockSource, stock } = get()
      if (stockSource === 'local') {
        await get().runStock(stock.symbol, stock.days, { persist: false })
      }
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

  runStock: async (ticker, days, opts) => {
    const { profile, holdings, workspaceId } = get()
    const persist = opts?.persist ?? true
    set({ running: true })
    try {
      // Backend first (canonical engine + real trace); local mirror offline.
      const r = await apiAnalyzeStock(
        ticker,
        days,
        profile,
        holdings,
        persist ? workspaceId : null,
      )
      set({
        stock: r.forecast,
        impact: r.impact,
        agentEvents: r.events,
        serverMemo: r.memo,
        narrator: r.narrator,
        stockSource: 'api',
        stockTab: 'forecast',
        backendOnline: true,
      })
      if (persist) void get().refreshHistory()
    } catch {
      const stock = analyzeStock(ticker, days)
      set({
        stock,
        impact: computeImpact(stock, holdings, profile),
        agentEvents: null,
        serverMemo: null,
        narrator: null,
        stockSource: 'local',
        stockTab: 'forecast',
        backendOnline: false,
      })
    } finally {
      set({ running: false })
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
  saveMemo: () => {
    const s = get()
    const memo: SavedMemo = {
      symbol: s.stock.symbol,
      rating: s.stock.rating,
      memo: buildSavedMemo(s.stock),
    }
    set({ stockMemory: [memo, ...s.stockMemory].slice(0, 8), stockTab: 'memory' })
    if (s.workspaceId && s.backendOnline) {
      void apiPostMemo(s.workspaceId, {
        symbol: memo.symbol,
        rating: memo.rating,
        body: memo.memo,
      }).catch(() => undefined)
    }
  },

  toggleConnection: (index) =>
    set((s) => ({
      connections: s.connections.map((c, i) => (i === index ? { ...c, on: !c.on } : c)),
    })),

  importHoldings: (holdings) => {
    if (!holdings.length) return
    set({ holdings, screen: 'portfolio' })
  },

  ask: async (text) => {
    const q = text.trim()
    if (!q) return
    const { holdings, profile, stock } = get()
    // Show the user's message immediately; the answer follows.
    set((s) => ({ chat: [...s.chat, { role: 'user', text: q }], advisorPending: true }))
    let reply: string
    try {
      reply = (await apiAskAdvisor(q, profile, holdings, stock)).answer
      set({ backendOnline: true })
    } catch {
      const analysis = analyzePortfolio(holdings, profile)
      reply = answerAdvisor(q, { analysis, stock })
      set({ backendOnline: false })
    }
    set((s) => ({ chat: [...s.chat, { role: 'ai', text: reply }], advisorPending: false }))
  },
}))

// --- Workspace bootstrap + hydration ---------------------------------------

type Set = (partial: Partial<AppState>) => void
type Get = () => AppState

async function bootstrapWorkspace(set: Set, get: Get): Promise<void> {
  try {
    let workspaceId = localStorage.getItem(LS_WORKSPACE_KEY)
    if (workspaceId) {
      set({ workspaceId })
    } else {
      workspaceId = (await apiCreateWorkspace()).id
      localStorage.setItem(LS_WORKSPACE_KEY, workspaceId)
      set({ workspaceId })
      // Fresh workspace: seed it with the current local state.
      await Promise.all([
        apiPutProfile(workspaceId, get().profile),
        apiPutHoldings(workspaceId, get().holdings),
      ])
      return
    }

    // Existing workspace: server state wins over the local snapshot.
    const state = await apiGetWorkspaceState(workspaceId)
    suppressSync = true
    try {
      if (state.profile) set({ profile: state.profile })
      if (state.holdings.length) set({ holdings: state.holdings })
      if (state.memos.length) {
        set({
          stockMemory: state.memos.slice(0, 8).map((m) => ({
            symbol: m.symbol,
            rating: m.rating as StockRating,
            memo: m.body,
          })),
        })
      }
    } finally {
      suppressSync = false
    }
  } catch {
    // Workspace gone (e.g. wiped DB) — mint a fresh one next check.
    localStorage.removeItem(LS_WORKSPACE_KEY)
  }
}

// --- Persistence subscription ----------------------------------------------
// localStorage mirror always; debounced server push when a workspace is live.

let pushTimer: ReturnType<typeof setTimeout> | undefined
let prevSlice = {
  profile: useStore.getState().profile,
  holdings: useStore.getState().holdings,
  stockMemory: useStore.getState().stockMemory,
}

useStore.subscribe((state) => {
  if (
    state.profile === prevSlice.profile &&
    state.holdings === prevSlice.holdings &&
    state.stockMemory === prevSlice.stockMemory
  ) {
    return
  }
  prevSlice = {
    profile: state.profile,
    holdings: state.holdings,
    stockMemory: state.stockMemory,
  }

  try {
    localStorage.setItem(
      LS_STATE_KEY,
      JSON.stringify({
        profile: state.profile,
        holdings: state.holdings,
        stockMemory: state.stockMemory,
      }),
    )
  } catch {
    // Storage full/unavailable — non-fatal.
  }

  if (suppressSync) return
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    const { workspaceId, backendOnline, profile, holdings } = useStore.getState()
    if (!workspaceId || !backendOnline) return
    void apiPutProfile(workspaceId, profile).catch(() => undefined)
    void apiPutHoldings(workspaceId, holdings).catch(() => undefined)
  }, 800)
})
