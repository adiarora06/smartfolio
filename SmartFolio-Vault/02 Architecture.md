# Architecture

## Current Prototype

The original deployed version is a single-page static application hosted on Vercel.

Current stack:

- HTML
- CSS
- JavaScript
- Vercel
- GitHub

## Implemented Frontend (Phase 2)

The static UI has been converted into a component-based **Vite + React 18 +
TypeScript** app in the `frontend/` directory, with **Zustand** for state.
Deterministic financial logic (`src/lib/calculations`) is kept strictly separate
from the AI explanation layer (`src/lib/ai`). Full detail and rationale (incl.
why React SPA over Next.js) in [[13 Frontend Architecture]].

## Implemented Backend (Phase 3)

A **Python FastAPI** service in `backend/` now owns the canonical deterministic
engine (`app/services`) and AI explanation layer (`app/services/ai`), with
Pydantic models mirroring the frontend types (camelCase wire contract).
Endpoints: `/health`, `/portfolio/analyze`, `/stocks/analyze`, `/advisor/ask`.
The frontend is backend-first for discrete actions with a client-side
deterministic mirror as offline fallback. Details in [[14 Backend API]].

## Production Target Architecture

```text
Frontend
  |
  |-- Guided Setup
  |-- Portfolio Workspace
  |-- Analyze Stock
  |-- Scenario Lab
  |-- AI Advisor
  |-- Connections Hub
  |
Backend API
  |
  |-- Profile Service
  |-- Portfolio Service
  |-- Market Data Service
  |-- Stock Forecast Service
  |-- Backtest Service
  |-- Recommendation Service
  |
Agent Orchestration Layer
  |
  |-- Profile Agent
  |-- Risk Agent
  |-- Portfolio Agent
  |-- Stock Forecast Agent
  |-- Backtest Agent
  |-- Recommendation Agent
  |-- Compliance Agent
  |
Data Layer
  |
  |-- Neon Postgres
  |-- pgvector
  |-- Market Data APIs
  |-- Brokerage Imports
```

## Recommended Production Stack

- React or Next.js frontend
- Python FastAPI backend
- Docker
- Neon Postgres
- Vercel deployment
- Live market data API
- Groq/OpenAI LLM routing
- MCP-style tools
- A2A-style agent coordination

## Design Rule

AI explains and reasons. Deterministic code calculates.

Use deterministic services for:

- asset allocation
- risk score
- target allocation gap
- concentration flags
- forecast bands
- backtest summaries
- scenario simulations

Use AI for:

- user-facing explanations
- investment memo generation
- natural language advisor responses
- summarizing tradeoffs
- asking follow-up questions

