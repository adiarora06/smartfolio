# SmartFolio

SmartFolio is an AI-assisted investment intelligence platform that combines guided investor onboarding, portfolio diagnostics, scenario modeling, an AI advisor, connected-data architecture, and an OpenVC-style stock analysis terminal.

Live demo: https://smartfolio-lemon.vercel.app/

## Highlights

- Public-facing onboarding with a **Skip to Demo** path.
- Portfolio workspace with holdings editing, allocation analysis, concentration flags, and target allocation gaps.
- Separate **Analyze Stock** section with forecast, backtest, topology, audit log, memory, and portfolio handoff.
- Scenario lab for simple contribution, return, and rebalancing simulations.
- AI advisor prototype for portfolio, stock, rebalancing, and connected-data questions.
- Connections hub designed for brokerage sync, CSV imports, market data APIs, MCP tools, and A2A agents.

## Resume Summary

Designed and deployed **SmartFolio**, an AI-assisted investment intelligence platform on Vercel combining investor onboarding, portfolio diagnostics, scenario modeling, and OpenVC-style stock analysis.

Built an A2A-style multi-agent architecture concept with Profile, Risk, Portfolio, Stock Forecast, Backtest, Recommendation, Compliance, and Advisor agents for explainable financial workflows.

Implemented deterministic analytics for allocation gaps, concentration risk, risk scoring, forecast bands, backtest summaries, and portfolio-level stock impact analysis.

## Tech

- `frontend/` — React 18 + TypeScript + Vite + Zustand (component-based conversion of the original static prototype)
- `backend/` — Python FastAPI + Pydantic: canonical deterministic financial engine + AI explanation layer (`/health`, `/portfolio/analyze`, `/stocks/analyze`, `/advisor/ask`)
- `index.html` — original static prototype (still what Vercel currently deploys)
- Deterministic code calculates; AI explains — enforced as a one-way import boundary on both sides
- Planned next: Neon Postgres persistence, live market data APIs, LLM provider routing, Docker, MCP tools, A2A-style agents

### Run locally

```bash
# backend
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000

# frontend (in another terminal)
cd frontend && npm install && npm run dev   # http://localhost:5173
```

The frontend auto-detects the backend on load and falls back to its built-in
client-side engine when the API is offline.

## Disclaimer

This is an educational prototype and does not provide financial advice.

