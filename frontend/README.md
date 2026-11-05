# SmartFolio Frontend

Component-based React frontend for SmartFolio — the Phase 2 conversion of the
static `index.html` prototype (see `../SmartFolio-Vault/10 Implementation Roadmap.md`).

## Stack

- React 18 + TypeScript
- Vite (build + dev server)
- Zustand (global state)

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build to dist/
npm run preview    # serve the production build
```

## Architecture

The one hard rule from the vault — **deterministic code calculates, AI explains** —
is enforced by the folder layout. Python owns canonical financial models; the
browser keeps only lightweight display math and explicit offline fallbacks:

```
src/
  lib/
    calculations/   # Display math and selected offline fallbacks
      portfolio.ts    value, allocation, risk score, gaps, concentration/recommendation signals
      stock.ts        forecast bands, confidence, rating, prototype backtest
      scenario.ts     immediate compounding projection + backend result types
    ai/             # EXPLANATION layer — turns findings into prose (LLM slots in here later)
      insights.ts     concentration/recommendation sentences
      memo.ts         stock research memos
      advisor.ts      conversational answers
    data/           # static inputs (target allocations, assumed returns, demo data)
    format.ts       # currency / percent / title helpers
  store/            # Zustand store — holds INPUTS only; analysis is derived, never stored
  hooks/            # usePortfolioAnalysis — derives the diagnosis from inputs
  components/
    layout/         # TopBar, SkipToDemoButton, Disclaimer
    landing/        # LandingPage
    setup/          # SetupFlow (guided onboarding)
    app/            # AppShell, SideNav, AgentPanel
      screens/      # Overview, Portfolio, AnalyzeStock, Scenarios, Advisor, Connections
    shared/         # ui primitives, ForecastChart, AllocationBars, InsightList
```

`lib/calculations` never imports from `lib/ai`. The AI layer consumes
deterministic findings, never the other way around.

## Delivery and bundle boundaries

The public landing and setup flows do not load the Ionic workspace runtime.
Entering the app fetches that runtime on demand, and each workspace route
(Overview, Portfolio, Analyze, AI Assistant, Connections, Open Source, and
More) is an independent lazy chunk. This keeps the marketing experience light
while preserving direct links to every application screen.

`npm run build` validates the generated Vite manifest after compilation. The
build fails if a route stops being lazy, initial static JavaScript exceeds the
budget, or any JavaScript chunk grows beyond the configured ceiling.

## Backend integration

`src/lib/api/` is a typed client for the FastAPI backend (`../backend`), which
owns the canonical financial models and AI layer. Base URL comes from
`VITE_API_URL` (default `http://localhost:8000`). Stock analysis and advisor
questions retain explicit local fallbacks; the Monte Carlo strategy lab is
backend-only and shows an honest reconnect state when Python is unavailable.
The Analyze terminal labels each run's engine and Connections shows live
backend status.

## Notes

- All financial "data" is a deterministic offline prototype (no live market
  feed yet) and is **educational only — not financial advice**.
- Global styles are ported verbatim from the prototype (`src/styles/index.css`)
  so the visual design is unchanged.
