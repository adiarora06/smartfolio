# Data Model

## Investor Profile

Fields SmartFolio should collect or infer:

- name
- age
- income range
- employment status
- investment horizon
- liquidity needs
- risk tolerance
- financial goals
- preferred sectors
- restricted sectors
- investing experience
- account types

## Holding

Represents one asset in a portfolio.

- symbol
- asset type
- quantity
- average cost
- current price
- market value
- allocation percentage
- unrealized gain or loss
- sector
- region

## Portfolio Snapshot

Represents a full portfolio at a point in time.

- profile id
- holdings
- total value
- cash allocation
- equity allocation
- fixed income allocation
- sector allocations
- concentration score
- volatility estimate
- diversification score
- created at

## Stock Analysis Run

Represents one OpenVC-style Analyze Stock session.

- symbol
- quote snapshot
- company summary
- technical indicators
- fundamental metrics
- financial news summary
- forecast scenarios
- backtest result
- agent outputs
- generated memo
- confidence score
- created at

## Recommendation

Represents a SmartFolio recommendation.

- recommendation type
- rationale
- expected impact
- risk impact
- diversification impact
- suggested allocation change
- supporting evidence
- AI explanation
- compliance disclaimer

## Memory

Project and user memory should be separated.

- project memory: architecture decisions, product roadmap, resume positioning
- user memory: profile, goals, holdings, watchlist, preferences
- analysis memory: prior stock analyses, generated memos, agent traces

## Implementation

These entities exist as typed contracts today (durable storage is Phase 4):

- Backend Pydantic schemas — [[14 Backend API]] (`backend/app/schemas.py`).
- Frontend TypeScript types — [[13 Frontend Architecture]]
  (`frontend/src/types.ts`), kept as a line-for-line mirror (camelCase wire).
- Neon Postgres persistence is designed in [[15 Improvement Design]] (M2).

