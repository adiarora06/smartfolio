# Agent System

## Agentic Architecture

SmartFolio is designed around an A2A-style multi-agent system.

## Agents

### Profile Agent

Collects investor context:

- age
- income
- monthly contribution
- goals
- time horizon
- liquidity needs

### Risk Agent

Scores risk tolerance and risk capacity.

Inputs:

- age
- time horizon
- emergency fund
- liquidity need
- risk tolerance

Outputs:

- conservative
- balanced
- growth
- aggressive

### Portfolio Agent

Analyzes holdings.

Responsibilities:

- allocation by asset class
- sector exposure
- single-stock concentration
- target allocation gap
- portfolio value

### Stock Forecast Agent

Powers the [[04 Analyze Stock]] section.

Responsibilities:

- ticker normalization
- forecast bands
- expected return
- confidence score
- research memo

### Backtest Agent

Runs historical or simulated backtests.

Prototype outputs:

- hit rate
- mean error
- sample windows
- drawdown proxy

### Recommendation Agent

Turns calculations into next steps.

Examples:

- increase international equity exposure
- reduce single-stock concentration
- connect brokerage data
- use future contributions to rebalance

### Compliance Agent

Ensures the app does not present outputs as financial advice.

Rules:

- no guaranteed returns
- no buy-now language
- educational framing
- show assumptions

