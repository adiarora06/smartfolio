# SmartFolio API

Python FastAPI backend for SmartFolio — the Phase 3 service that owns the
canonical deterministic financial engine and the AI explanation layer.

## Run locally

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Interactive docs at http://localhost:8000/docs.

## Endpoints

| Method | Path                 | What it does |
|--------|----------------------|--------------|
| GET    | `/health`            | Liveness check (the frontend pings this to detect the backend) |
| POST   | `/portfolio/analyze` | Deterministic portfolio diagnosis + AI-layer insight prose |
| POST   | `/portfolio/performance` | Range-aware Modified Dietz history from dated values and recorded cash flows |
| POST   | `/portfolio/positions` | Position-level cost-basis coverage and optional quote-only price refresh |
| POST   | `/portfolio/rebalance` | Preview exact-cent buy/sell dollar actions against a risk-profile or custom target |
| POST   | `/portfolio/scenario-lab` | Seeded strategy comparisons + contribution optimizer |
| POST   | `/stocks/analyze`    | Deterministic OpenVC-style forecast for a ticker + horizon |
| POST   | `/advisor/ask`       | Advisor answer grounded in a fresh analysis of the sent state |

`POST /profiles` and `GET /analyses/{id}` from the roadmap land with
persistence (Phase 4 — Neon Postgres).

## Rebalancing preview

`POST /portfolio/rebalance` is deliberately preview-only (`previewOnly` must be
`true`). It accepts the current `holdings`, either an investor `profile`, named
`targetProfile`, or custom `targetAllocation`, plus:

- `mode: "rebalance" | "new_money_only"`
- `contributionAmount` (new cash available to the plan)
- `minTradeAmount` (minimum asset-class drift worth acting on)

All money math is performed in integer cents. Target dollars use a stable
largest-remainder allocation, so they add to `afterTotal` exactly. New money is
distributed proportionally across positive post-contribution target deficits.
For resolved buys, the largest existing holding in that asset class receives
the addition; sells use the largest holding first and cascade only when needed,
minimizing line items with symbol/name as stable tie-breakers.

The engine never invents a ticker. A required asset class with no existing
holding produces a trade with `symbol: null`, `resolved: false` and contributes
to `unresolvedAmount`; the UI must ask the user to choose a vehicle before
applying. `projectedHoldings` contains resolved changes only, while
`afterAllocation`, `totalBuys`, and `totalTraded` include the intended unresolved
trades. Truly unallocated money is added to an existing cash holding when one
is available; otherwise it remains `cashRemaining`. The accounting invariant is:

```text
sum(projectedHoldings.value) + cashRemaining + unresolvedAmount = afterTotal
```

`warnings` are structured (`code`, `message`, optional `asset`/`amount`) and
cover minimum-trade suppression, contribution-only infeasibility, unresolved
buy targets, cash constraints, and residual target drift. `canApply` is false
whenever a target is unresolved or cash remains outside the projected holdings.
It is also false when a dollar trade would change a share-tracked holding while
leaving its recorded quantity unchanged; an executed quantity must be recorded
before that preview can replace the portfolio.

## Enriched holdings and position P&L

The original value-only holding payload remains valid. Holdings can now also
carry a stable `id`, `quantity`, `averageCost`, aggregate `costBasis`,
`currentPrice`, `priceAsOf`, `priceSource`, and holding `source`. `value` remains
required and authoritative: SmartFolio never reverse-engineers shares from a
dollar balance. When quantity and either basis form are present, the other
basis form is derived; inconsistent basis inputs are rejected.

`POST /portfolio/positions` derives unrealized gain only for positions with a
known basis and reports value-weighted cost, quantity, and priced coverage.
Missing basis is `null`, never presented as a zero gain. Cash is intentionally
treated as cost-covered at its nominal value with zero unrealized gain and is
excluded from share-data coverage denominators.

With `refreshPrices: true`, the endpoint uses the market resolver's quote-only
path, not the deep stock-analysis path, and deduplicates repeated symbols.
Share-tracked holdings are explicitly revalued as quantity × refreshed price;
value-only holdings retain their reported value. Synthetic offline reference
prices are not applied unless `allowOfflineReferencePrices: true`. Every result
retains price provider, as-of date, cache/reference status, and structured
warnings.

## Portfolio History

`POST /portfolio/performance` accepts explicit valuations, transactions, and a
rolling or custom range. The backend geometrically links Modified Dietz
intervals, weighting deposits and withdrawals by their recorded date. The
response includes effective dates, account-value and normalized benchmark
points, estimated return, net change after recorded external flows,
snapshot-observed drawdown, interval details, and structured data-coverage
warnings.

This endpoint deliberately does not reconstruct history from current holdings.
Its return is an estimate, ledger completeness is unknown, and total-value
snapshots cannot establish historical allocation drift or holding-level return
attribution. Conflicting same-day valuations, invalid capital bases, mixed
benchmark symbols, and insufficient ranges return an explicit partial or
unavailable state instead of a fabricated percentage.

## Architecture

Same rule as everywhere in SmartFolio — **deterministic code calculates, AI
explains** — expressed in the package layout:

```
app/
  schemas.py        # Pydantic contract — mirrors frontend/src/types.ts (camelCase wire)
  api.py            # routes: each composes services + ai explicitly
  main.py           # app factory, CORS, /health
  services/         # Canonical deterministic financial engine
    portfolio.py      value, allocation, risk score, gaps, structured findings
    performance.py    dated value history, Modified Dietz intervals, coverage
    rebalance.py      exact-cent preview planner, constraints, projected holdings
    stock.py          forecast bands, confidence, rating, prototype backtest
    data.py           targets, assumed returns, offline stock reference table
    ai/             # EXPLANATION layer (mirror of frontend lib/ai — LLM slots in here)
      insights.py     findings → sentences
      advisor.py      conversational answers
      format.py       currency/pct/title helpers matching the frontend
```

`services/*.py` never imports from `services/ai/` — the dependency flows one
way, AI ← findings.

## Live market data

By default the app uses the built-in **offline reference prices** (deterministic
demo data — e.g. AAPL is a fixed $215). To show **real prices**, set a free API
key and restart:

```bash
# Alpha Vantage — free key at https://www.alphavantage.co/support/#api-key (~20s)
export MARKET_DATA_PROVIDER=alphavantage
export MARKET_DATA_API_KEY=your_key_here
.venv/bin/uvicorn app.main:app --reload --port 8000

# …or Finnhub (60 req/min free) — https://finnhub.io/register
export MARKET_DATA_PROVIDER=finnhub
export MARKET_DATA_API_KEY=your_key_here
```

- With no key, every ticker resolves offline (today's behavior) and the terminal
  labels the price "Offline reference price".
- With a key, the price/`as_of`/source come from the provider; the terminal
  shows "Live price · <provider> · <date>". The forecast **formulas are
  unchanged** — only the price input goes live.
- Any provider failure (rate limit, unknown symbol, network) falls back to the
  offline base for that ticker — the app never breaks.
- Alpha Vantage's public `demo` key only serves **IBM** — handy for a quick live
  test; all other tickers fall back offline.
- Quotes are cached in-process for `MARKET_DATA_CACHE_TTL` seconds (default 900)
  to protect free-tier budgets.

`GET /health` reports `liveMarketData` and `marketDataProvider`.

## AI narration (LLM routing)

With `ANTHROPIC_API_KEY` set, research memos and advisor answers are written by
a real LLM (default model `claude-opus-4-8`, override with `LLM_MODEL`) that
receives the deterministic results as read-only JSON context. Output is
validated by the compliance module (no guarantees, no buy/sell language — one
stricter retry, then the deterministic template) and the disclaimer is appended
server-side. **Without a key, behavior is byte-identical to the deterministic
templates** — the app never depends on the LLM. Responses carry
`narrator: "llm" | "template"`.

## Persistence

SQLite by default — `backend/data/smartfolio.db` is created on first start and
survives restarts with zero setup. Point `DATABASE_URL` at Postgres/Neon for
cloud deploys (install an async driver, e.g. `pip install asyncpg`, and use
`postgresql+asyncpg://...`). Anonymous workspaces: the frontend mints an id
(`POST /workspaces`), keeps it in localStorage, hydrates via
`GET /workspaces/{id}/state`, and saves with debounced PUTs. Analysis runs sent
with an `X-Workspace-Id` header are stored and replayable via
`GET /analyses/{id}` when the same workspace header is provided.

Holding rows retain an internal integer database key and expose a separate,
workspace-scoped stable holding id. An idempotent startup migration adds and
backfills the enriched fields on existing SQLite or Postgres databases without
deleting holdings. Holdings PUT now upserts stable ids and deletes only rows
omitted from the submitted collection; id-less legacy saves remain accepted
and receive canonical ids in the response. Transactions may optionally link to
a holding through `holdingId`.

## Config

- `SMARTFOLIO_CORS_ORIGINS` — comma-separated allowed origins. Defaults to the
  Vite dev server (`localhost:5173`) and the Vercel deployment.
- `MARKET_DATA_PROVIDER` — `alphavantage` (default) or `finnhub`.
- `MARKET_DATA_API_KEY` — provider key; unset = offline-only.
- `MARKET_DATA_CACHE_TTL` — quote cache seconds (default `900`).
- `MARKET_DATA_TIMEOUT` — provider request timeout seconds (default `6`).
- `ANTHROPIC_API_KEY` — enables LLM narration; unset = templates.
- `LLM_MODEL` — Anthropic model id (default `claude-opus-4-8`).
- `LLM_MAX_TOKENS` / `LLM_TIMEOUT` — narration limits (default `1024` / `10`s).
- `DATABASE_URL` — SQLAlchemy async URL (default SQLite file under `data/`).
- `VITE_API_URL` (frontend) — backend base URL (default `http://localhost:8000`).

## Disclaimer

Educational prototype. All analysis is deterministic offline reference data —
not live market data, and not financial advice.
