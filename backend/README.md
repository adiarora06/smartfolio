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
| POST   | `/stocks/analyze`    | Deterministic OpenVC-style forecast for a ticker + horizon |
| POST   | `/advisor/ask`       | Advisor answer grounded in a fresh analysis of the sent state |

`POST /profiles` and `GET /analyses/{id}` from the roadmap land with
persistence (Phase 4 — Neon Postgres).

## Architecture

Same rule as everywhere in SmartFolio — **deterministic code calculates, AI
explains** — expressed in the package layout:

```
app/
  schemas.py        # Pydantic contract — mirrors frontend/src/types.ts (camelCase wire)
  api.py            # routes: each composes services + ai explicitly
  main.py           # app factory, CORS, /health
  services/         # DETERMINISTIC engine (1:1 port of frontend lib/calculations)
    portfolio.py      value, allocation, risk score, gaps, structured findings
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
`GET /analyses/{id}`.

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
