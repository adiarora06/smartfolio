# Agent System

## Agentic Architecture

SmartFolio is designed around an A2A-style multi-agent system. The pipeline
below is the one actually implemented in `backend/app/orchestrator.py` — each
step emits a timed `AgentEvent`, and that trace is what the Analyze Stock
Audit Log tab and the Open Source screen's agent graph render.

## The Analyze Stock Pipeline (as built)

Runs in order on every `POST /stocks/analyze`:

### 1. Ticker Intake Agent

Normalizes inputs:

- uppercases and trims the symbol
- clamps the horizon to 7–365 days
- falls back to AAPL / 30 days on garbage input

### 2. Market Data Tool

Resolves the price:

- live provider chain (Finnhub or Alpha Vantage, per `MARKET_DATA_PROVIDER`)
- 15-minute in-process TTL cache with per-symbol fetch coalescing
- offline reference engine as the always-available backstop

### 3. Stock Forecast Agent

Deterministic forecast over the snapshot:

- bear / median / bull bands
- expected return
- confidence score

### 4. Backtest Agent

Prototype evaluation:

- sample windows
- hit rate
- mean error
- drawdown proxy

### 5. Portfolio Agent

The what-if against the holdings sent with the request:

- new portfolio weight if the position were added
- sector exposure after
- single-stock and sector concentration flags

### 6. Memo Writer

The AI explanation layer:

- LLM narration when a key is configured (OpenAI or Anthropic via
  `LLM_PROVIDER`), deterministic template otherwise
- receives deterministic results as read-only JSON; instructed never to
  invent numbers

### 7. Compliance Agent

Enforcement, not fiction:

- regex rules against guarantees and buy/sell imperatives
- rejects non-compliant narration → serves the deterministic template
- appends the disclaimer server-side

## Where the old Profile / Risk / Recommendation agents went

Their responsibilities exist as deterministic services, not orchestrated
pipeline agents:

- **Profile & Risk** — the guided setup flow collects investor context, and
  `services/portfolio.py` scores risk into a target profile during every
  portfolio analysis.
- **Recommendation** — `services/portfolio.py` emits structured
  recommendations (rebalance gradually, reduce concentration, …) which the
  AI layer narrates.

If they are ever promoted to real pipeline steps, add them to
`orchestrator.py` first, then update the Open Source screen graph and this
note (see [[02 Architecture]]).

## Design Rule

Deterministic code computes every number; AI only narrates. The Compliance
Agent guards every output. See [[12 AI Architecture Decisions]].
