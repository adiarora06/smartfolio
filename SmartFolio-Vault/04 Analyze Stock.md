# Analyze Stock

## Purpose

Analyze Stock is SmartFolio's OpenVC-style stock analysis section.

It is separate from portfolio management but feeds portfolio decisions.

## User Flow

1. Enter ticker.
2. Choose forecast horizon.
3. Run analysis.
4. Review forecast.
5. Inspect backtest.
6. View topology.
7. Check audit log.
8. Save research memory.
9. Add stock to portfolio.

## Terminal Sections

### Forecast

Shows:

- current price
- median target
- expected return
- confidence
- bear path
- median path
- bull path

### Backtest

Shows:

- sample windows
- hit rate
- mean error
- drawdown proxy

### Topology

Shows the agent/tool flow:

```text
Ticker Intake Agent
  -> Market Data Tool
  -> Forecast Agent
  -> Backtest Agent
  -> Portfolio Agent
  -> Compliance Agent
```

### Audit Log

Tracks:

- ticker normalized
- market data resolved
- forecast generated
- backtest sampled
- memo written

### Memory

Stores saved stock memos for later retrieval.

## Key Product Insight

Analyze Stock is not just a stock picker. It should answer:

> How would this stock affect my portfolio?

