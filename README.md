# SmartFolio

AI investment intelligence platform: guided investor onboarding, live portfolio
diagnostics, an OpenVC-style stock analysis terminal, scenario modeling, and an
AI advisor — built on a strict rule: **deterministic code calculates every
number; AI only explains.**

**Live demo:** https://smartfolio-lemon.vercel.app
**Live API:** https://smartfolio-api-yjcj.onrender.com/health

## Architecture

```
Vercel (React 18 + TypeScript + Vite + Zustand)
  │  REST/JSON, gzip
  ▼
Render (FastAPI + Pydantic v2 — rate limited, request-id structured logs)
  │
  ├─ Agent pipeline (orchestrator.py — every step emits a timed AgentEvent):
  │    Ticker Intake → Market Data Tool → Stock Forecast → Backtest
  │    → Portfolio (what-if) → Memo Writer (LLM) → Compliance (guardrail)
  │
  ├─ Market data: Finnhub / Alpha Vantage, TTL cache + per-symbol
  │    fetch coalescing, offline reference backstop
  ├─ LLM routing: OpenAI ↔ Anthropic with automatic failover,
  │    deterministic template as the final fallback
  └─ Neon Postgres (asyncpg, pre-ping pooling) — anonymous workspaces,
       persisted analysis history, memos
```

The frontend also ships a complete **local mirror** of the deterministic
engine — the demo keeps working with the backend offline, and the UI shows
which engine answered (`API` vs `Local`, LLM vs template narration).

## The compliance stance

Educational analysis only, enforced in code: the LLM receives deterministic
results as read-only JSON and its output is validated by a Compliance agent
(rules against guarantees and buy/sell language). Non-compliant narration is
rejected and replaced with the deterministic template; the disclaimer is
appended server-side, never left to the model.

## Features

- **Portfolio workspace** — editable holdings with live-recalculating metric
  cards, an asset-class donut, and position-weight bars
- **Analyze Stock terminal** — forecast bands, backtest, a real agent audit
  trail with per-step timings, saved memos, and replayable run **history**
  (persisted server-side per anonymous workspace)
- **Scenario lab** — contribution / return / rebalance sliders driving a
  10-year projection chart (with-contributions vs growth-only)
- **AI advisor** — answers grounded in a fresh deterministic analysis of the
  exact state you send; works keylessly via templates
- **Open Source screen** — the real agent graph and pipeline, matching the
  trace the backend emits

## Running locally

```bash
# Backend (Python 3.12+)
cd backend
cp .env.example .env       # keys optional — keyless mode is fully functional
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (Node 20+, separate terminal)
cd frontend
npm install
npm run dev                # http://localhost:5173, auto-detects the backend
```

Everything degrades gracefully with zero keys: offline reference prices,
template narration, SQLite persistence.

## Configuration

| Env var | Effect (all optional) |
|---|---|
| `MARKET_DATA_API_KEY` + `MARKET_DATA_PROVIDER` | Live quotes (finnhub / alphavantage) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | LLM narration; both set → automatic failover |
| `LLM_PROVIDER`, `LLM_MODEL` | Primary provider and model |
| `DATABASE_URL` | Neon/Postgres (raw Neon URL accepted); default SQLite |
| `SMARTFOLIO_CORS_ORIGINS` | Allowed browser origins |
| `SENTRY_DSN` | Error tracking |

## Tests & CI

- `backend/tests` — pytest across the full API surface (17 tests)
- `frontend/src/**/__tests__` — Vitest over the deterministic engine (11 tests)
- GitHub Actions runs both suites + the frontend build on every push/PR; a
  keep-warm cron pings the free-tier backend every 10 minutes

## Docs

- [SCALING_PLAN.md](SCALING_PLAN.md) — phased path to production scale
- [RENDER_DEPLOYMENT.md](RENDER_DEPLOYMENT.md) / [DEPLOYMENT_PIPELINE.md](DEPLOYMENT_PIPELINE.md) — deploy runbooks
- [OPENAI_SETUP.md](OPENAI_SETUP.md) — LLM provider setup
- `SmartFolio-Vault/` — Obsidian vault: architecture notes, agent system,
  data model, decisions

## Disclaimer

Educational prototype. Not financial advice.
