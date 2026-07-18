# Backend API

Status: implemented in Phase 3 (2026-07-17); major expansion 2026-07-18
(orchestrator + impact, persistence, LLM routing — M1/M2/M4 of
[[15 Improvement Design]]). Python FastAPI service in `backend/` of the parent
repo. See [[13 Frontend Architecture]] for the client side and
[[10 Implementation Roadmap]] for phase status.

## What It Is

The backend is the **canonical** home of both layers of the core rule:

- `app/services/` — the deterministic financial engine (1:1 port of the
  frontend's `lib/calculations`): portfolio diagnosis, risk scoring, stock
  forecast bands, prototype backtests. Numbers and structured findings only.
- `app/services/ai/` — the explanation layer (mirror of the frontend's
  `lib/ai`): findings → sentences, advisor answers. This is where LLM provider
  routing plugs in later.
- `app/schemas.py` — Pydantic models mirroring the frontend TypeScript types
  field-for-field; snake_case in Python, camelCase on the wire via alias
  generation, so both sides share one contract.

## Endpoints

- `GET /health` — liveness + capability flags (live data, LLM, database)
- `POST /portfolio/analyze` — deterministic diagnosis + AI-layer insight prose
- `POST /stocks/analyze` — **full pipeline run**: forecast + optional what-if
  impact (send `profile` + `holdings`) + real agent trace + narrated memo.
  With an `X-Workspace-Id` header the run is persisted to history.
- `POST /advisor/ask` — advisor answer (LLM or template) + `narrator` tag
- `POST /workspaces` · `GET /workspaces/{id}/state` · `PUT .../profile` ·
  `PUT .../holdings` · `POST .../memos` · `GET .../analyses` — anonymous
  workspace persistence (no accounts; id lives in the browser's localStorage)
- `GET /analyses/{id}` — a full stored run, replayable (the roadmap endpoint)

## Agent Orchestration (M1 — 2026-07-18)

`app/orchestrator.py` runs the stock analysis as a real pipeline of named,
timed steps: Ticker Intake → Market Data Tool → Stock Forecast → Backtest →
**Portfolio Agent (what-if impact)** → Memo Writer → Compliance. Each step
emits an `AgentEvent {agent, status, duration_ms, detail}` — the frontend's
Audit Log renders this real trace (millisecond timings, actual data
provenance) instead of the old static strings.

`app/services/impact.py` answers the product's core question deterministically:
adding `round(price*10)` of the stock — new combined weight, sector weight
after, single-stock (>20%) and sector (>35%) flag triggers, and per-asset-class
allocation-gap deltas. Mirrored in `frontend/src/lib/calculations/impact.ts`.

## LLM Routing (M4 — 2026-07-18)

`app/services/ai/llm.py`: AsyncAnthropic (official SDK) with
`LLM_MODEL=claude-opus-4-8` default, adaptive thinking, low effort, 10s
timeout. Surfaces: memo narration and advisor answers. The LLM receives the
deterministic results as **read-only JSON context** and is instructed never to
invent numbers. `app/services/ai/compliance.py` is enforcement, not fiction:
banned-pattern validation (guarantees, buy/sell imperatives, "risk-free"...),
one stricter retry, then the deterministic template; the disclaimer is appended
server-side. Keyless deploys are byte-identical to template behavior
(verified). Responses carry `narrator: "llm" | "template"`.

## Persistence (M2 — 2026-07-18)

`app/db.py`: SQLAlchemy 2.0 async. **SQLite file by default**
(`backend/data/smartfolio.db`, gitignored — zero-setup persistence, verified to
survive restarts); set `DATABASE_URL` for Neon/Postgres. Tables: workspaces,
profiles, holdings, stock_runs (full response as JSON), memos. Schema is
`create_all` on startup — move to Alembic when it stabilizes. Anonymous
workspace model: the frontend mints an id once, keeps it in localStorage,
hydrates on load, and pushes debounced saves. Auth is explicitly out of scope.

## Key Decision: Hybrid Determinism (Backend-First, Local Fallback)

The frontend keeps its client-side deterministic mirror and uses the backend as
the source of truth when reachable:

- **Backend-first for discrete actions** — Run Analysis, advisor questions, and
  Export JSON call the API; the Analyze Stock terminal shows which engine
  produced the result ("· API" / "· Local"), and the Connections screen has a
  real SmartFolio API card with live health status.
- **Local mirror for continuous interactions** — live holdings editing and
  scenario sliders recompute instantly client-side (identical formulas), which
  keeps the UI at 60fps and avoids per-keystroke API chatter.
- **Graceful degradation** — every API call falls back to the local engine on
  failure, so the static Vercel deploy works fully offline. Verified: killing
  the backend mid-session switches runs to "· Local" with zero errors.

Why this is right for now: identical formulas on both sides make the swap
invisible, and Phases 4–5 (persistence, live market data, real LLM calls)
naturally force the discrete actions to be backend-only — the seams are already
in place. When live data lands, the offline mirror becomes explicitly a
"demo/offline mode".

## Run Locally

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000   # docs at /docs
```

Frontend targets `http://localhost:8000` by default; override with
`VITE_API_URL`. CORS allows the Vite dev server and the Vercel domain
(override with `SMARTFOLIO_CORS_ORIGINS`).

## Verified (2026-07-17)

- All endpoints return exact parity with the frontend engine (same numbers,
  character-identical prose) — checked via curl against browser-observed values.
- Browser end-to-end: health detection on load, MSFT run via API, advisor
  answer via API (confirmed in uvicorn access logs), fallback to local after
  killing the backend. Zero console errors.

## Live Market Data (added 2026-07-17)

`app/marketdata/` resolves a ticker to a `MarketSnapshot` via a provider chain:
a live provider (Alpha Vantage or Finnhub, selected by env) supplies the real
price; the offline reference table always backstops it. `analyze_stock` consumes
the snapshot — **the forecast formulas are unchanged, only the price input goes
live**. `StockForecast` gained `source` + `asOf`; the terminal shows "Live price
· <provider> · <date>" or "Offline reference price". `/health` reports
`liveMarketData`/`marketDataProvider`.

- Config: `MARKET_DATA_PROVIDER`, `MARKET_DATA_API_KEY` (unset = offline),
  `MARKET_DATA_CACHE_TTL` (in-process quote cache, default 900s).
- Graceful: any provider failure (rate limit, unknown symbol, network) falls
  back to offline per-ticker. Keyless deploys behave exactly as before.
- Verified: with AV `demo` key, IBM resolved live ($212.67, as-of today) through
  to the UI; AAPL fell back offline ($215) with the offline label — zero errors.
- Datacenter note: keyless scrape sources (Stooq, Yahoo) are bot-blocked from
  server IPs, so a keyed provider is the reliable path. This partially delivers
  the M3 milestone in [[15 Improvement Design]] (live price done; live
  vol/trend from history + DB-backed cache still pending).

## Not Yet Done

- Neon/Postgres in production (code-ready via `DATABASE_URL`; needs a driver
  install — asyncpg/psycopg — and an Alembic migration baseline).
- Live vol/trend from historical series + DB-backed quote cache (rest of M3).
- Live-LLM path exercised end-to-end (needs the user's `ANTHROPIC_API_KEY`;
  keyless fallback + compliance validator are verified).
- Rate limiting, structured logging, CI (M5); deployment of the new backend
  ([[06 Deployment]] — Render env needs `DATABASE_URL`/`ANTHROPIC_API_KEY`).
