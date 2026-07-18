# Frontend Architecture

Status: implemented in Phase 2 (2026-07-17). Supersedes the single static
`index.html` prototype as the primary frontend. See [[10 Implementation Roadmap]].

## Stack Decision

**Vite + React 18 + TypeScript**, in a new `frontend/` directory of the parent
repo.

Why not Next.js: the target architecture (see [[02 Architecture]]) puts all
server logic in a **separate Python FastAPI backend** (Phase 3). Next.js's SSR
and API routes would sit unused, and a "Next.js app that calls a separate Python
API" invites the question "why Next.js?". A clean React SPA that consumes the
FastAPI API over HTTP is the more coherent, defensible design. Vite gives fast
builds and a trivial static deploy to Vercel.

State management: **Zustand** — small, avoids prop-drilling, keeps components
clean.

## Monorepo Layout

```text
so-i-have-this-right-uses/
  index.html         # original static prototype (kept live during migration)
  frontend/          # NEW — React SPA (this note)
  backend/           # FUTURE — FastAPI service (Phase 3)
  SmartFolio-Vault/  # this vault (project memory)
```

## The Core Rule, Enforced by Folders

The vault rule — **deterministic code calculates, AI explains** — is expressed
as a hard import boundary:

```text
src/lib/
  calculations/   DETERMINISTIC engine. Pure functions. Returns numbers and
                  STRUCTURED findings (never prose).
    portfolio.ts    value, allocation, risk score, gaps,
                    concentration + recommendation SIGNALS
    stock.ts        forecast bands, confidence, rating, backtest
    scenario.ts     compounding projection
  ai/             EXPLANATION layer. Turns findings into sentences.
                  This is the seam where a real LLM plugs in later.
    insights.ts     concentration / recommendation prose
    memo.ts         stock research memos
    advisor.ts      conversational answers
```

Rule: `lib/calculations` **never** imports from `lib/ai`. The AI layer consumes
the deterministic findings; the dependency only flows one way. When the FastAPI
backend lands, `lib/calculations` maps onto its deterministic services and
`lib/ai` onto its LLM-routing layer — the split is already drawn.

## State Model

- The Zustand store holds **inputs and UI state only**: profile, holdings,
  connections, chat, saved memos, the current forecast snapshot, and navigation.
- **Derived portfolio analysis is never stored.** `usePortfolioAnalysis()`
  recomputes it from inputs via the deterministic engine. Single source of
  truth; mirrors "state in, calculations derived" on the backend.

## Component Map

- `layout/` — TopBar, SkipToDemoButton (reused in 3 places), Disclaimer
- `landing/` — LandingPage (hero, preview, features)
- `setup/` — SetupFlow (guided onboarding wizard)
- `app/` — AppShell, SideNav
- `app/screens/` — Overview, Portfolio, AnalyzeStock, Scenarios, Advisor,
  Connections, OpenSource
- `shared/` — ui primitives (Panel/AppHero/MetricCard), ForecastChart, AllocationBars, InsightList

## Customer / Internals Separation (2026-07-18)

Product decision: system internals ("how it works") are not shown on the
screens a general customer uses. They live in a dedicated **Open Source**
screen (last nav item):

- The sidebar **Agent Network panel was removed** (AgentPanel.tsx deleted).
- The Analyze Stock terminal **lost its Topology tab** — the terminal keeps
  only actionable tabs (Forecast, Backtest, Audit Log, Memory).
- `OpenSourceScreen` now holds: an **SVG agent graph** (8 nodes / 7 edges —
  profile flow and market flow converging on the Portfolio Agent, Compliance
  as the amber guardrail), the **active agents list** (7 agents with live
  API/local status), the run pipeline steps, the design rule, and a
  View-on-GitHub link.
- Connections' API card copy was de-jargoned ("Analysis service · live market
  data").

## Fidelity Notes

- Global CSS is ported **verbatim** from the prototype (`src/styles/index.css`),
  and component markup keeps the original class names, so the visual design is
  unchanged.
- One deliberate behavior fix: the prototype rendered the onboarding inputs but
  never captured them into the profile. They are now wired to the store, so
  investor context actually flows into the app (Review step + dashboard update
  live). UI unchanged.

## Full-App State Model (added 2026-07-18)

- **Impact card + real trace**: the Analyze Stock terminal shows the
  deterministic what-if (position size, new weight, sector after, flags) and
  the Audit Log renders the backend's real timed AgentEvents. Local mode keeps
  parity via `lib/calculations/impact.ts` (falls back to static trace).
- **Async UX**: `running` disables/labels the Run button; the advisor shows a
  Thinking… bubble while a request is in flight.
- **Persistence**: localStorage always mirrors profile/holdings/memos (reload
  survives offline); when the backend is up, an anonymous workspace id (also
  localStorage) hydrates server state on load and receives debounced (800ms)
  saves. Server state wins over the local snapshot on hydrate; only
  user-initiated analysis runs are persisted to history (the on-load hydration
  run passes `persist: false`).

## Backend Integration (added in Phase 3)

`src/lib/api/client.ts` is a typed client for the FastAPI backend
([[14 Backend API]]), base URL from `VITE_API_URL` (default
`http://localhost:8000`). Discrete actions (Run Analysis, advisor questions,
Export JSON) are backend-first with the local engine as fallback; continuous
interactions (holdings editing, scenario sliders) stay client-side for instant
recomputation. The Analyze Stock terminal shows the engine source
("· API" / "· Local") and Connections has a live SmartFolio API status card.

## Not Yet Done (follow-ups)

- Wire Vercel to build `frontend/` (currently the root static prototype is what
  deploys). This is a Phase 6 / deployment task — see [[06 Deployment]].
- ~~Extract the contracts for FastAPI Pydantic models~~ — done in Phase 3:
  `backend/app/schemas.py` mirrors `src/types.ts` (camelCase wire format).
