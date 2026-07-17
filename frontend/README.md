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
is enforced by the folder layout:

```
src/
  lib/
    calculations/   # DETERMINISTIC engine — pure math, returns numbers + structured findings
      portfolio.ts    value, allocation, risk score, gaps, concentration/recommendation signals
      stock.ts        forecast bands, confidence, rating, prototype backtest
      scenario.ts     compounding projection
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

`lib/calculations` never imports from `lib/ai`. The AI layer consumes the
deterministic findings, never the other way around.

## Backend integration

`src/lib/api/` is a typed client for the FastAPI backend (`../backend`), which
owns the canonical version of both layers. Base URL comes from `VITE_API_URL`
(default `http://localhost:8000`). Discrete actions — Run Analysis, advisor
questions, Export JSON — are **backend-first with local fallback**: when the
API is unreachable the app degrades to the client-side mirror above, so it
works fully offline. The Analyze Stock terminal labels each run's engine
("· API" / "· Local") and the Connections screen shows live backend status.

## Notes

- All financial "data" is a deterministic offline prototype (no live market
  feed yet) and is **educational only — not financial advice**.
- Global styles are ported verbatim from the prototype (`src/styles/index.css`)
  so the visual design is unchanged.
