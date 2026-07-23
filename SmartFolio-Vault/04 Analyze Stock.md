# Analyze Stock

## Purpose

Analyze Stock is SmartFolio's OpenVC-style stock analysis section.

It is separate from portfolio management but feeds portfolio decisions.

## User Flow

1. Enter ticker.
2. Choose forecast horizon.
3. Run analysis.
4. Review forecast cone.
5. Inspect portfolio impact.
6. Check backtest calibration.
7. Audit the model inputs.
8. Save research memory.
9. Add stock to portfolio.

## The Forecast Model

The engine fits a **lognormal price cone** (geometric Brownian motion):

```text
ln(S_t / S_0) ~ Normal( (mu - sigma^2 / 2) * t,  sigma^2 * t )

S_q(t) = S_0 * exp( (mu - sigma^2 / 2) * t + z_q * sigma * sqrt(t) )
```

The band therefore widens with `sqrt(t)`, and the 25–75 band contains half the
probability mass **by construction** — you can read a probability off the chart.

- `sigma` — annualized realized volatility, measured from actual daily returns
  (EWMA blended 70/30 with the equal-weighted estimate). Returns are winsorized
  at 4 sigma first; without that a single crash bar defines the whole
  distribution (a real -25% IBM session drove an estimate to 104% annualized).
- `mu` — a weighted blend of real signals (12-1 momentum, 6-month momentum,
  trailing Sharpe, analyst target less an optimism-bias haircut, earnings yield,
  fundamental quality, news tone), then **shrunk hard toward a market baseline**.
  Shrinkage scales with how much real data arrived, so a ticker with nothing
  measured collapses to the market prior instead of inventing conviction.

Everything reported — targets, P(gain), P(beat market), P(drawdown) — is a
property of that one fitted distribution, not a separate heuristic.

## Terminal Sections

### Forecast

Fan chart with two shaded bands (5–95 and 25–75) around the median, opening
from a single point at today's price. Metrics: price, median target, 50% band,
P(gain), P(beat market), P(-20% drawdown).

### Portfolio Impact

Answers the product's core question. Two parts, because they routinely disagree:

- **Concentration** — weight, sector weight, flags (weights only)
- **Risk** — portfolio volatility and beta before/after, share of total risk,
  95% VaR, effective positions, return per unit of risk, and the max position
  size that stays inside the profile's volatility ceiling

A position can pass every concentration check and still be the largest single
contributor to portfolio risk. See [[05 Portfolio Intelligence]].

### Backtest

**Calibration first.** Walk-forward: at each past origin the series is truncated
to that date, the same estimator is refit on what was visible then, and its band
is compared to the price one horizon later. No data after an origin reaches its
own forecast.

- `coverage50` / `coverage90` — how often reality landed inside the bands
  (well-calibrated is ~50% and ~90%)
- directional hit rate, median absolute error, bias
- `independentWindows` — overlapping windows are not independent evidence, so
  this reports how many non-overlapping horizons the sample really spans

When there is not enough history the panel says so rather than showing a
plausible-looking number derived from the forecast's own assumptions.

### Model Inputs

The honesty panel: fitted `mu`/`sigma`, every drift signal with its weight and
provenance, data completeness, measured history statistics, fundamentals, stale
inputs, and data-integrity warnings.

### Memory

Stores saved stock memos for later retrieval.

## Data Sources — hybrid Finnhub + Alpha Vantage

The two free tiers are complementary, so the resolver uses **both**:

| Provider | Role | Free-tier reality |
| --- | --- | --- |
| **Finnhub** | live quote (spot price) + fundamentals fallback | 60 req/min, but **no** historical candles |
| **Alpha Vantage** | daily history, fundamentals, news sentiment | history + fundamentals, but **~25 req/day** |

Finnhub answers the frequent quote calls (its strength); Alpha Vantage's scarce
budget is spent only on the daily history + fundamentals Finnhub free can't
provide. Set `MARKET_DATA_PROVIDER=finnhub` + `MARKET_DATA_API_KEY` (Finnhub)
and `ALPHAVANTAGE_API_KEY` to run the hybrid. When only one key is present the
resolver degrades to that provider alone.

Endpoints, each cached and degrading independently:

| Endpoint | Provider | Feeds | Cache TTL |
| --- | --- | --- | --- |
| `/quote` | Finnhub | spot price | 15 min |
| `TIME_SERIES_DAILY` | Alpha Vantage | volatility, momentum, drawdown, backtest | 1 day |
| `OVERVIEW` | Alpha Vantage | quality, beta, analyst target, valuation | 7 days |
| `/stock/metric` + `/stock/profile2` | Finnhub | **fundamentals fallback** when AV is throttled | 7 days |
| `NEWS_SENTIMENT` | Alpha Vantage | sentiment drift tilt | 6 hours |

Payloads are cached in Postgres (not just memory) so the budget survives the
restarts a free-tier host does constantly. An expired payload beats no payload:
when a provider is throttled the stale row is served and reported as stale. When
Alpha Vantage's OVERVIEW is unavailable, Finnhub's free metrics fill in the
fundamentals so both providers contribute. `/health` reports `marketDataProvider`,
`deepDataProvider`, and `hybridMarketData` so the split is visible.

Without any deep key, volatility falls back to the reference table and the
backtest does not run — the UI reports this rather than hiding it.

## Data Integrity

If the quote diverges more than 25% from the latest daily close, the engine
keeps the close (the value the statistics are measured on) and surfaces a
warning. Anchoring the cone on a price the statistics disagree with — an
unadjusted split, a bad tick, a symbol collision — would describe two different
instruments in one forecast.

## Agent Topology

```text
Ticker Intake Agent
  -> Market Data Tool          (quote, history, fundamentals, news)
  -> Parameter Estimation Agent (fits sigma and a shrunk mu)
  -> Stock Forecast Agent       (lognormal quantile cone)
  -> Backtest Agent             (walk-forward calibration)
  -> Portfolio Agent            (single-index risk decomposition)
  -> Memo Writer                (LLM when configured, template otherwise)
  -> Compliance Agent
```

## Key Product Insight

Analyze Stock is not just a stock picker. It should answer:

> How would this stock affect my portfolio?

## Implementation

- Distributional math: `backend/app/services/quant.py`, mirrored in
  `frontend/src/lib/calculations/quant.ts` (asserted equal to 10 decimals).
- Estimation: `backend/app/services/estimate.py` — shared by the live forecast
  and the backtest, so the backtest scores the same estimator users get.
- Walk-forward: `backend/app/services/backtest.py`.
- Risk model: `backend/app/services/risk.py` (single-index), consumed by
  `services/impact.py`.
- Market data: `backend/app/marketdata/` (providers, cache, series statistics).
- API contract: [[14 Backend API]]. Terminal UI: [[13 Frontend Architecture]].
- The deterministic-math / AI-narration split is unchanged — see
  [[12 AI Architecture Decisions]].
