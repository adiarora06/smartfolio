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
  AssistantHandoff,
  AssistantSourceContext,
  ChatMessage,
  Connection,
  Holding,
  InvestorProfile,
  Narrator,
  Page,
  PortfolioImpact,
  PortfolioTransaction,
  SavedMemo,
  SavedStrategyPlan,
  Screen,
  StockForecast,
  StockRating,
  StockTab,
  ValuationSnapshot,
} from '../types'
import {
  DEFAULT_PROFILE,
  SETUP_STEPS,
  defaultConnections,
  demoHoldings,
  demoTransactions,
  demoValuations,
  initialChat,
} from '../lib/data/constants'
import { analyzePortfolio } from '../lib/calculations/portfolio'
import { analyzeStock } from '../lib/calculations/stock'
import { computeImpact } from '../lib/calculations/impact'
import type { AdvisorScenarioContext } from '../lib/calculations/scenario'
import { buildSavedMemo } from '../lib/ai/memo'
import { answerAdvisor } from '../lib/ai/advisor'
import { navigateTo, screenFromPath } from '../lib/nav'
import {
  applyHoldingPatch,
  createHoldingId,
  normalizeHolding,
  normalizeHoldings,
  type NormalizedHolding,
} from '../lib/holdings'
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
  apiPutTransactions,
  apiPutValuations,
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
  strategyPlans?: SavedStrategyPlan[]
  transactions?: PortfolioTransaction[]
  valuations?: ValuationSnapshot[]
}

function loadLocalSnapshot(): LocalSnapshot {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(LS_STATE_KEY)
    return raw ? (JSON.parse(raw) as LocalSnapshot) : {}
  } catch {
    return {}
  }
}

// Guard: while hydrating from the server we suppress the echo-push.
let suppressSync = false
let workspaceBootstrap: Promise<void> | null = null

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
  /** Evidence carried from a recommendation into AI Assistant. */
  assistantHandoff: AssistantHandoff | null

  // domain inputs
  profile: InvestorProfile
  holdings: NormalizedHolding[]
  connections: Connection[]
  chat: ChatMessage[]
  stockMemory: SavedMemo[]
  strategyPlans: SavedStrategyPlan[]
  transactions: PortfolioTransaction[]
  valuations: ValuationSnapshot[]

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
  openAssistant: (context: AssistantSourceContext) => void
  clearAssistantHandoff: () => void
  /** Set `screen` without navigating (router -> store sync only). */
  syncScreen: (screen: Screen) => void
  setStockTab: (tab: StockTab) => void
  nextSetupStep: () => void
  prevSetupStep: () => void

  // profile / onboarding
  updateProfile: (patch: Partial<InvestorProfile>) => void

  // holdings
  addHolding: () => string
  removeHolding: (id: string) => void
  updateHolding: <K extends Exclude<keyof Holding, 'id'>>(
    id: string,
    field: K,
    value: Holding[K],
  ) => void
  replaceHolding: (id: string, holding: Holding) => void
  replaceHoldings: (holdings: Holding[]) => void
  resetHoldings: () => void
  addTransaction: (
    transaction: Omit<PortfolioTransaction, 'id' | 'source'> & {
      source?: PortfolioTransaction['source']
    },
  ) => void
  removeTransaction: (id: string) => void
  recordValuation: (
    valuation: Omit<ValuationSnapshot, 'id' | 'source'> & {
      source?: ValuationSnapshot['source']
    },
  ) => void
  removeValuation: (id: string) => void
  applyPortfolioImport: (payload: {
    holdings: Holding[]
    transactions: PortfolioTransaction[]
    valuations: ValuationSnapshot[]
  }) => void

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
  ask: (
    text: string,
    scenario?: AdvisorScenarioContext,
    sourceContext?: AssistantSourceContext,
  ) => Promise<void>
  saveStrategyPlan: (plan: Omit<SavedStrategyPlan, 'id' | 'createdAt'>) => void
  removeStrategyPlan: (id: string) => void
}

const local = loadLocalSnapshot()
const initialProfile = local.profile ?? { ...DEFAULT_PROFILE }
const initialHoldings = normalizeHoldings(
  local.holdings !== undefined ? local.holdings : demoHoldings(),
  local.holdings !== undefined ? 'manual' : 'demo',
)
const initialTransactions = local.transactions ?? demoTransactions()
const initialValuations = local.valuations ?? demoValuations()
const initialStock = analyzeStock('AAPL', 30)

// Persist upgraded legacy holdings immediately. Waiting for the first edit
// would generate a different identity if the user reloaded beforehand.
if (local.holdings !== undefined && typeof localStorage !== 'undefined') {
  try {
    localStorage.setItem(LS_STATE_KEY, JSON.stringify({ ...local, holdings: initialHoldings }))
  } catch {
    // Storage can be disabled or full; the in-memory upgrade still works.
  }
}

/** Current path, or '' where there is no DOM (Node tests, SSR). */
const initialPathname = (): string =>
  typeof window === 'undefined' ? '' : window.location.pathname

export const useStore = create<AppState>((set, get) => ({
  // The web build opens on the marketing landing page. Two exceptions:
  //   - native: an installed app has no one left to pitch, and launching into
  //     marketing copy is exactly what Guideline 4.2 reads as a repackaged
  //     website, so it opens straight into the dashboard;
  //   - a deep link to an app route (/portfolio, /stock, …) must land on that
  //     screen rather than the landing page — otherwise the URLs the router
  //     hands out are not actually openable.
  // Set as initial state (not in an effect) so neither case flashes the
  // landing page first.
  // The store is created at module scope, so this runs on import — guard the
  // window access or importing the store throws under Node (tests, SSR).
  page: screenFromPath(initialPathname()) ? 'app' : 'landing',
  screen: 'overview',
  setupStep: 0,
  stockTab: 'forecast',
  running: false,
  advisorPending: false,
  assistantHandoff: null,

  profile: initialProfile,
  holdings: initialHoldings,
  connections: defaultConnections(),
  chat: initialChat(),
  stockMemory: local.stockMemory ?? [],
  strategyPlans: local.strategyPlans ?? [],
  transactions: initialTransactions,
  valuations: initialValuations,

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
    const { workspaceId } = get()
    if (!workspaceId) return
    try {
      const r = await apiGetAnalysis(analysisId, workspaceId)
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
      workspaceBootstrap ??= bootstrapWorkspace(set, get).finally(() => {
        workspaceBootstrap = null
      })
      await workspaceBootstrap
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
  // Navigate *and* set state. The route change is what produces the native
  // push transition; ScreenSync then confirms `screen` from the URL, so
  // swipe-back and browser-back stay consistent with this value.
  setScreen: (screen) => {
    set({ screen })
    navigateTo(screen)
  },
  openAssistant: (context) => {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `assistant-${Date.now()}`
    set({
      assistantHandoff: { ...context, id, createdAt: new Date().toISOString() },
      screen: 'scenarios',
    })
    navigateTo('scenarios')
  },
  clearAssistantHandoff: () => set({ assistantHandoff: null }),
  /** State-only setter used by ScreenSync — must not navigate (would loop). */
  syncScreen: (screen) => set({ screen }),
  setStockTab: (stockTab) => set({ stockTab }),
  nextSetupStep: () =>
    set((s) =>
      s.setupStep === SETUP_STEPS.length - 1
        ? { page: 'app', screen: 'overview' }
        : { setupStep: s.setupStep + 1 },
    ),
  prevSetupStep: () => set((s) => ({ setupStep: Math.max(0, s.setupStep - 1) })),

  updateProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),

  addHolding: () => {
    const id = createHoldingId()
    const holding = normalizeHolding({
      id,
      symbol: '',
      name: '',
      type: 'stock',
      asset: 'us_equity',
      sector: 'technology',
      value: 0,
      source: 'manual',
    })
    set((state) => ({ holdings: [...state.holdings, holding] }))
    return id
  },
  removeHolding: (id) =>
    set((state) => ({ holdings: state.holdings.filter((holding) => holding.id !== id) })),
  updateHolding: (id, field, value) =>
    set((state) => ({
      holdings: state.holdings.map((holding) => {
        if (holding.id !== id) return holding
        const patch = { [field]: value } as Partial<Omit<Holding, 'id'>>
        return applyHoldingPatch(holding, patch)
      }),
    })),
  replaceHolding: (id, replacement) =>
    set((state) => ({
      holdings: state.holdings.map((holding) =>
        holding.id === id
          ? normalizeHolding({ ...replacement, id }, replacement.source ?? holding.source)
          : holding,
      ),
    })),
  replaceHoldings: (holdings) => set({ holdings: normalizeHoldings(holdings) }),
  resetHoldings: () => set({ holdings: normalizeHoldings(demoHoldings(), 'demo') }),

  addTransaction: (transaction) =>
    set((state) => {
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `transaction-${Date.now()}`
      return {
        transactions: [
          { ...transaction, id, source: transaction.source ?? 'manual' },
          ...state.transactions,
        ],
      }
    }),
  removeTransaction: (id) =>
    set((state) => ({
      transactions: state.transactions.filter((transaction) => transaction.id !== id),
    })),
  recordValuation: (valuation) =>
    set((state) => {
      const existing = state.valuations.find((snapshot) => snapshot.date === valuation.date)
      const id =
        existing?.id ??
        (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `valuation-${Date.now()}`)
      const next: ValuationSnapshot = {
        ...valuation,
        benchmarkValue: valuation.benchmarkValue ?? existing?.benchmarkValue ?? null,
        id,
        source: valuation.source ?? 'manual',
      }
      return {
        valuations: [
          ...state.valuations.filter((snapshot) => snapshot.date !== valuation.date),
          next,
        ].sort((a, b) => a.date.localeCompare(b.date)),
      }
    }),
  removeValuation: (id) =>
    set((state) => ({
      valuations: state.valuations.filter((snapshot) => snapshot.id !== id),
    })),
  applyPortfolioImport: (payload) =>
    set((state) => ({
      holdings: payload.holdings.length
        ? normalizeHoldings(payload.holdings, 'imported')
        : state.holdings,
      transactions: payload.transactions.length ? payload.transactions : state.transactions,
      valuations: payload.valuations.length ? payload.valuations : state.valuations,
      screen: 'portfolio',
    })),

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
        normalizeHolding({
          id: createHoldingId(),
          symbol: s.stock.symbol,
          name: s.stock.name,
          type: 'stock',
          asset: 'us_equity',
          sector: s.stock.sector,
          value: Math.round(s.stock.price * 1000) / 100,
          source: 'analysis',
          quantity: 10,
          averageCost: s.stock.price,
          costBasis: Math.round(s.stock.price * 1000) / 100,
          currentPrice: s.stock.price,
          priceAsOf: s.stock.asOf ?? null,
          priceSource: s.stock.source,
        }, 'analysis'),
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
    set({ holdings: normalizeHoldings(holdings, 'plaid'), screen: 'portfolio' })
  },

  saveStrategyPlan: (plan) =>
    set((state) => {
      const existing = state.strategyPlans.find(
        (item) =>
          item.contribution === plan.contribution &&
          item.returnPts === plan.returnPts &&
          item.rebalPts === plan.rebalPts &&
          item.goalValue === plan.goalValue &&
          item.targetProbability === plan.targetProbability,
      )
      const id = existing?.id ??
        (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `plan-${Date.now()}`)
      const saved: SavedStrategyPlan = {
        ...plan,
        id,
        createdAt: new Date().toISOString(),
      }
      return {
        strategyPlans: [
          saved,
          ...state.strategyPlans.filter((item) => item.id !== id),
        ].slice(0, 8),
      }
    }),
  removeStrategyPlan: (id) =>
    set((state) => ({ strategyPlans: state.strategyPlans.filter((plan) => plan.id !== id) })),

  ask: async (text, scenario, sourceContext) => {
    const q = text.trim()
    if (!q) return
    const { holdings, profile, stock } = get()
    // Show the user's message immediately; the answer follows.
    set((s) => ({
      chat: [...s.chat, { role: 'user', text: q, sourceContext }],
      advisorPending: true,
    }))
    let reply: string
    try {
      reply = (await apiAskAdvisor(q, profile, holdings, stock, scenario, sourceContext)).answer
      set({ backendOnline: true })
    } catch {
      const analysis = analyzePortfolio(holdings, profile)
      reply = answerAdvisor(q, { analysis, stock, scenario, sourceContext })
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
        apiPutTransactions(workspaceId, get().transactions),
        apiPutValuations(workspaceId, get().valuations),
      ])
      return
    }

    // Existing workspace: server state wins over the local snapshot.
    const state = await apiGetWorkspaceState(workspaceId)
    suppressSync = true
    try {
      if (state.profile) set({ profile: state.profile })
      set({ holdings: normalizeHoldings(state.holdings) })
      if (state.transactions.length) set({ transactions: state.transactions })
      if (state.valuations.length) set({ valuations: state.valuations })
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
    const foundationSeeds: Promise<unknown>[] = []
    if (!state.transactions.length && get().transactions.length) {
      foundationSeeds.push(apiPutTransactions(workspaceId, get().transactions))
    }
    if (!state.valuations.length && get().valuations.length) {
      foundationSeeds.push(apiPutValuations(workspaceId, get().valuations))
    }
    if (foundationSeeds.length) await Promise.all(foundationSeeds)
  } catch {
    // Workspace gone (e.g. wiped DB) — mint a fresh one next check.
    localStorage.removeItem(LS_WORKSPACE_KEY)
  }
}

// --- Persistence subscription ----------------------------------------------
// localStorage mirror always; debounced server push when a workspace is live.

let pushTimer: ReturnType<typeof setTimeout> | undefined
let pendingServerChanges = {
  profile: false,
  holdings: false,
  transactions: false,
  valuations: false,
}
let prevSlice = {
  profile: useStore.getState().profile,
  holdings: useStore.getState().holdings,
  stockMemory: useStore.getState().stockMemory,
  strategyPlans: useStore.getState().strategyPlans,
  transactions: useStore.getState().transactions,
  valuations: useStore.getState().valuations,
}

useStore.subscribe((state) => {
  if (
    state.profile === prevSlice.profile &&
    state.holdings === prevSlice.holdings &&
    state.stockMemory === prevSlice.stockMemory &&
    state.strategyPlans === prevSlice.strategyPlans
    && state.transactions === prevSlice.transactions
    && state.valuations === prevSlice.valuations
  ) {
    return
  }
  const profileChanged = state.profile !== prevSlice.profile
  const holdingsChanged = state.holdings !== prevSlice.holdings
  const transactionsChanged = state.transactions !== prevSlice.transactions
  const valuationsChanged = state.valuations !== prevSlice.valuations
  const serverInputsChanged =
    profileChanged || holdingsChanged || transactionsChanged || valuationsChanged
  prevSlice = {
    profile: state.profile,
    holdings: state.holdings,
    stockMemory: state.stockMemory,
    strategyPlans: state.strategyPlans,
    transactions: state.transactions,
    valuations: state.valuations,
  }

  try {
    localStorage.setItem(
      LS_STATE_KEY,
      JSON.stringify({
        profile: state.profile,
        holdings: state.holdings,
        stockMemory: state.stockMemory,
        strategyPlans: state.strategyPlans,
        transactions: state.transactions,
        valuations: state.valuations,
      }),
    )
  } catch {
    // Storage full/unavailable — non-fatal.
  }

  if (suppressSync || !serverInputsChanged) return
  pendingServerChanges.profile ||= profileChanged
  pendingServerChanges.holdings ||= holdingsChanged
  pendingServerChanges.transactions ||= transactionsChanged
  pendingServerChanges.valuations ||= valuationsChanged
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    const changes = pendingServerChanges
    pendingServerChanges = {
      profile: false,
      holdings: false,
      transactions: false,
      valuations: false,
    }
    const { workspaceId, backendOnline, profile, holdings, transactions, valuations } = useStore.getState()
    if (!workspaceId || !backendOnline) return
    if (changes.profile) void apiPutProfile(workspaceId, profile).catch(() => undefined)
    if (changes.holdings) void apiPutHoldings(workspaceId, holdings).catch(() => undefined)
    if (changes.transactions) {
      void apiPutTransactions(workspaceId, transactions).catch(() => undefined)
    }
    if (changes.valuations) void apiPutValuations(workspaceId, valuations).catch(() => undefined)
  }, 800)
})
