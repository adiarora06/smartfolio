# Implementation Roadmap

> Engineering blueprint for the remaining phases (M1–M5 sequencing, schemas,
> contracts, verification criteria): [[15 Improvement Design]].

## Phase 1 - Prototype Hardening

Goal: make the current SmartFolio demo feel like a polished public financial application.

- Keep the guided setup flow.
- Keep the top skip button that jumps into the current dashboard experience.
- Preserve Analyze Stock as a separate product section.
- Improve empty states, loading states, and responsive behavior.
- Add clear disclaimers that outputs are educational and not financial advice.

## Phase 2 - Frontend Application  ✅ (in progress — 2026-07-17)

Goal: move from static prototype toward a maintainable app.

Done: converted `index.html` into a component-based **Vite + React + TypeScript**
app in `frontend/`, with the deterministic/AI split enforced by folder structure
and Zustand for state. See [[13 Frontend Architecture]]. Remaining: client-side
persistence of setup answers across reloads, and point Vercel at `frontend/`.

- Convert `index.html` into React or Next.js.
- Create reusable UI modules:
  - onboarding wizard
  - portfolio dashboard
  - Analyze Stock workspace
  - agent activity panel
  - forecast chart
  - risk profile summary
- Add client-side state management for setup answers and analysis sessions.

## Phase 3 - Backend Services  ✅ (core done — 2026-07-17)

Goal: create production APIs that separate data, calculations, and AI.

Done: FastAPI service in `backend/` with typed Pydantic models, deterministic
services + AI explanation layer, CORS, and endpoints `/health`,
`/portfolio/analyze`, `/stocks/analyze`, `/advisor/ask` — wired into the
frontend with graceful local fallback. See [[14 Backend API]]. Remaining:
provider fallback for market data/LLM; `POST /profiles` and `GET /analyses/{id}`
move to Phase 4 (they need persistence).

- Add Python FastAPI service.
- Add typed Pydantic models for profiles, holdings, analyses, forecasts, and memos.
- Add REST endpoints:
  - `POST /profiles`
  - `POST /portfolio/analyze`
  - `POST /stocks/analyze`
  - `GET /analyses/{id}`
  - `GET /health`
- Add provider fallback for market data and LLM calls.

## Phase 4 - Persistence

Goal: make SmartFolio remember users, portfolios, and analysis history.

- Add Neon Postgres.
- Store:
  - investor profiles
  - holdings
  - risk scores
  - watchlists
  - analysis runs
  - agent traces
  - generated investment memos
- Add migration tooling.

## Phase 5 - Agentic Intelligence

Goal: make the AI architecture resume-ready.

- Implement A2A-style orchestration.
- Add specialized agents from [[03 Agent System]].
- Add RAG over project memory, filings, financial documents, and generated memos.
- Add MCP-style connectors for external tools.
- Add evaluation tests for agent output quality and factual grounding.

## Phase 6 - Production Deployment

Goal: make the app demonstrably cloud-native.

- Deploy frontend on Vercel.
- Deploy backend on a production service or Vercel Functions if suitable.
- Add environment variables for market data, database, and LLM providers.
- Add health checks.
- Add rate limiting.
- Add structured logging.
- Add CI checks.

