# Improvement Design

Status: designed 2026-07-17, not yet implemented. This is the engineering
blueprint for taking the working Phase 2/3 app ([[13 Frontend Architecture]],
[[14 Backend API]]) to the full production vision in [[02 Architecture]] and
[[10 Implementation Roadmap]] (Phases 4–6), plus the missing product core.

Guiding constraints (unchanged):

- Deterministic code calculates; AI explains. LLMs never produce numbers.
- No guaranteed financial claims; educational framing everywhere.
- The app must keep working with zero external keys/services (fallback chain
  ends at the current offline deterministic engine).
- Verification is behavioral: drive the running app, not test suites.

## Milestone Map (recommended order)

| # | Milestone | Value | New infra |
|---|-----------|-------|-----------|
| M1 | Portfolio Impact + real agent orchestration + async UX states | Product core: answers "does this stock fit MY portfolio" | none |
| M2 | Persistence (Neon Postgres, workspaces, saved runs/memos) | App remembers users; roadmap endpoints land | Neon |
| M3 | Live market data with provider fallback | Real prices/vol feed the deterministic engine | 1 free API key (optional) |
| M4 | LLM provider routing in the AI layer | Real memos + advisor; compliance guardrails | 1 LLM key (optional) |
| M5 | Deployment + ops (Docker, CI, logging, rate limits) | Publicly demonstrable, cloud-native | Render/Vercel config |

M1 first deliberately: it needs no accounts, no keys, no DB — and it closes the
biggest gap between the product's pitch and what the app actually does.

## M1 — Portfolio Impact + Real Agent Orchestration

### Problem

[[04 Analyze Stock]]'s key insight — "How would this stock affect my
portfolio?" — is not implemented anywhere. And the Topology/Audit tabs render
static strings; the "agents" are UI fiction.

### Design

Backend `app/orchestrator.py`: a small typed pipeline runner. Each agent is a
step with a name, a pure `run(ctx) -> ctx` over a shared context, and an
emitted trace event:

```python
class AgentEvent(ApiModel):
    agent: str            # "Ticker Intake Agent", "Forecast Agent", ...
    status: Literal["succeeded", "failed", "skipped"]
    duration_ms: float
    detail: str           # deterministic one-liner, e.g. "AAPL normalized, 30d horizon"
```

Stock analysis becomes a real pipeline: TickerIntake → MarketData → Forecast →
Backtest → **PortfolioImpact** → Compliance, each wrapping the existing
deterministic functions. The response gains:

```python
class PortfolioImpact(ApiModel):      # deterministic what-if, no prose
    added_value: float                # proposed position size (default: round(price*10))
    new_weight: float                 # stock weight after adding
    sector_weight_after: float
    concentration_delta: float        # change in top-position weight
    gap_delta: Dict[str, float]       # allocation-gap shift per asset class
    triggers_single_stock_flag: bool
    triggers_sector_flag: bool

class StockAnalyzeResponse(ApiModel):
    forecast: StockForecast
    impact: Optional[PortfolioImpact]  # present when holdings are sent
    events: List[AgentEvent]           # replaces static trace strings
```

`POST /stocks/analyze` accepts optional `profile` + `holdings` so the
PortfolioImpact agent can run the real diagnosis before/after. The AI layer
(`services/ai/insights.py`) gains `describe_impact()` — sentences like "Adding
~$2,150 of AAPL raises Technology exposure to 47.8% and would trigger a sector
concentration flag."

Frontend:

- Forecast pane gets an **Impact card** (the impact prose + before/after bars).
- Topology/Audit tabs render `events` — real names, real timings, real status —
  falling back to the static strings in local mode.
- Async UX: `running` flag in the store → "Running…" state on the Run button,
  disabled while in flight; advisor gets a pending indicator; failed API calls
  show an inline notice (not just silent fallback).

Local mirror: port `PortfolioImpact` math to `lib/calculations/impact.ts` so
offline mode keeps parity (same hybrid-determinism rule as [[14 Backend API]]).

Verify: run AAPL with the demo portfolio → impact card shows sector weight
rising and flags firing; audit tab shows six events with millisecond timings;
kill backend → local run still shows impact (without server events).

## M2 — Persistence (Phase 4)

### Stack

- **SQLAlchemy 2.0 (async) + asyncpg + Alembic** migrations; `DATABASE_URL`
  env pointing at Neon. `app/db/` package: `engine.py`, `models.py`, `repo.py`.
- No accounts/auth yet: an anonymous **workspace** token (UUID) minted by
  `POST /workspaces`, kept in `localStorage`, sent as `X-Workspace-Id`. This
  gives multi-device-less persistence without touching credentials (out of
  scope by design). Real auth is a later, separate decision.

### Schema (Alembic revision 0001)

```text
workspaces        id uuid pk, created_at
profiles          id uuid pk, workspace_id fk unique, age, income, contribution,
                  horizon, risk, emergency, goal, liquidity, updated_at
holdings          id uuid pk, workspace_id fk, symbol, name, type, asset,
                  sector, value numeric, position int, updated_at
stock_runs        id uuid pk, workspace_id fk, symbol, days, engine text,
                  request jsonb, result jsonb, created_at
portfolio_runs    id uuid pk, workspace_id fk, request jsonb, result jsonb, created_at
memos             id uuid pk, workspace_id fk, symbol, rating, body, stock_run_id fk?, created_at
advisor_messages  id uuid pk, workspace_id fk, role, text, created_at
agent_traces      id uuid pk, stock_run_id fk, agent, status, duration_ms, detail, seq int
```

`jsonb` for run payloads is deliberate: the shape is already governed by the
Pydantic contract; relational columns exist only where we query/filter.

### Endpoints (completes the roadmap set)

- `POST /workspaces` → `{id}`
- `GET/PUT /profiles` (workspace-scoped) — the roadmap's `POST /profiles`
- `GET/PUT /holdings` (bulk replace; the editor saves debounced)
- `GET /analyses/{id}` and `GET /analyses?limit=` — saved runs (both kinds)
- `POST /memos`, `GET /memos`
- `GET/POST /advisor/messages` (history)

Analysis runs are persisted server-side automatically inside the existing
`/stocks/analyze` and `/portfolio/analyze` handlers when a workspace header is
present — no new frontend calls needed for history to accumulate.

Frontend: `lib/api/workspace.ts` bootstraps the token on load; store hydrates
profile/holdings/memos/chat from the API when online, `localStorage` when not;
Memory tab and advisor history become durable across reloads.

Verify: edit holdings → reload page → holdings persist; run analyses → Memory
tab lists them after reload; `GET /analyses/{id}` returns a past run; offline
still works via localStorage.

## M3 — Live Market Data (provider fallback)

> **Partially implemented 2026-07-17** (see [[14 Backend API]]): the provider
> chain (Alpha Vantage / Finnhub → offline), env config, per-ticker graceful
> fallback, in-process TTL cache, and `source`/`asOf` provenance in the UI are
> done — live **price** flows end-to-end. Still pending from this milestone:
> live **vol/trend** derived from historical series, and moving the cache into
> Postgres (needs M2).

`app/marketdata/` with a provider chain:

```python
class MarketDataProvider(Protocol):
    async def snapshot(self, symbol: str) -> MarketSnapshot | None
        # MarketSnapshot: price, realized_vol, trend, sector, name, source, as_of

chain = [FinnhubProvider(api_key), DbCacheProvider(ttl=15m), OfflineReferenceProvider()]
```

- Live provider (Finnhub or Alpha Vantage free tier — pick at implementation
  time by key availability; env `MARKET_DATA_API_KEY`, absent = skip).
- Derivations are deterministic and ours: `realized_vol` = annualized stddev of
  daily log returns (252d), `trend` = 1y drift, `quality` stays a static
  per-sector table until fundamentals arrive.
- Cache layer writes through to Postgres (M2) so repeat tickers don't burn API
  quota; TTL 15 minutes.
- `StockForecast` gains `source: "live" | "cache" | "offline"` + `as_of`;
  the MarketData agent event reports real provenance ("price via finnhub,
  as of 14:02"). The UI shows it in the terminal header next to API/Local.

Formulas in `services/stock.py` are unchanged — only their inputs go live.
Keyless deploys degrade to today's behavior automatically.

Verify: with a key set, AAPL price matches the real quote and audit shows
"live"; unset the key → identical flow on offline reference data.

## M4 — LLM Routing (the AI layer becomes real)

`app/services/ai/llm.py`:

```python
class LLMProvider(Protocol):
    async def complete(self, system: str, user: str, max_tokens: int) -> str

router = LLMRouter(primary=AnthropicProvider(model=env LLM_MODEL),
                   fallback=TemplateProvider())   # today's templating, always available
```

- Default model via env (`LLM_MODEL`, e.g. a current Claude model; consult the
  claude-api reference at implementation time — never from memory).
- Used by exactly three surfaces, all currently templated: memo generation,
  insight narration, advisor answers. Each call passes the **deterministic
  results as read-only JSON context** (forecast numbers, findings, impact);
  the system prompt forbids inventing numbers and mandates educational tone.
- 10s timeout → fallback to templates; the response is tagged
  `narrator: "llm" | "template"` so the UI can subtly show it.
- **Compliance agent becomes enforcement**: `services/ai/compliance.py`
  validates LLM output (banned patterns: guarantees, buy/sell imperatives,
  "can't lose", return promises). One violation → single retry with stricter
  instruction → else template fallback. Disclaimer is appended server-side,
  never left to the model.
- Cost control: memo responses cached per `(symbol, days, inputs-hash)` in
  Postgres; advisor capped at modest max_tokens; no streaming in v1 (SSE is a
  later nicety).

Verify: with a key, advisor answers are grounded in the actual numbers (spot-
check against the deterministic payload) and every response carries the
disclaimer; without a key, behavior is byte-identical to today.

## M5 — Deployment + Ops (Phase 6)

- **Backend**: `backend/Dockerfile` (python-slim, uvicorn, non-root) +
  `render.yaml` blueprint (Render free tier; Fly.io as alternate). Env:
  `DATABASE_URL`, `SMARTFOLIO_CORS_ORIGINS`, optional `MARKET_DATA_API_KEY`,
  `ANTHROPIC_API_KEY`/`LLM_MODEL`.
- **Frontend**: point Vercel Root Directory at `frontend/` (dashboard change),
  `VITE_API_URL` env set to the Render URL. The root static prototype retires
  only after the SPA deploy is confirmed live.
- **Ops hardening** in FastAPI: `slowapi` rate limiting (e.g. 30 req/min/IP on
  POST routes), structured JSON logging with request IDs, `/health` extended
  with db/provider status, CORS narrowed to the real origins.
- **CI** (GitHub Actions, per project preference — no unit-test authoring):
  frontend `npm ci && npm run build`; backend install + boot smoke
  (`uvicorn` up → curl `/health` + one `/stocks/analyze` round-trip).
- **Local dev**: `docker-compose.yml` with api + postgres for key-free local
  persistence work; Neon stays the cloud target.

Verify: fresh clone → `docker compose up` → app fully works locally; deployed
URLs pass the same browser drive-through as dev.

## Frontend Polish (woven through M1–M4)

- Loading/disabled states on every async action; inline error notices.
- Empty states: portfolio with zero holdings, memory with no runs.
- URL routing (react-router) for shareable `/app/stock` etc. — stretch, M5.
- Accessibility: label/`htmlFor` pairs, focus-visible rings, aria-pressed on
  tabs — cheap wins during M1's screen edits.

## Explicit Non-Goals (for now)

- Real authentication/accounts (workspace token only; auth is its own design).
- Brokerage/Plaid connections (cards stay "planned" in Connections).
- Trading of any kind — SmartFolio analyzes; it never executes.
- Unit-test suites — verification stays behavioral per project preference.

## Risks / Decisions

- **Neon cold starts** on free tier → keep localStorage hydration so UX never
  blocks on the DB.
- **Quota exhaustion** (market data) → cache + offline chain make it invisible.
- **LLM drift/cost** → template fallback is always one timeout away; memo cache.
- **Contract drift** between TS types and Pydantic schemas → single source
  discipline: any wire change edits `types.ts` + `schemas.py` in one commit
  (they are line-for-line mirrors today; keep it that way).
