# Architecture

## Current Prototype

The current deployed version is a single-page static application hosted on Vercel.

Current stack:

- HTML
- CSS
- JavaScript
- Vercel
- GitHub

## Production Target Architecture

```text
Frontend
  |
  |-- Guided Setup
  |-- Portfolio Workspace
  |-- Analyze Stock
  |-- Scenario Lab
  |-- AI Advisor
  |-- Connections Hub
  |
Backend API
  |
  |-- Profile Service
  |-- Portfolio Service
  |-- Market Data Service
  |-- Stock Forecast Service
  |-- Backtest Service
  |-- Recommendation Service
  |
Agent Orchestration Layer
  |
  |-- Profile Agent
  |-- Risk Agent
  |-- Portfolio Agent
  |-- Stock Forecast Agent
  |-- Backtest Agent
  |-- Recommendation Agent
  |-- Compliance Agent
  |
Data Layer
  |
  |-- Neon Postgres
  |-- pgvector
  |-- Market Data APIs
  |-- Brokerage Imports
```

## Recommended Production Stack

- React or Next.js frontend
- Python FastAPI backend
- Docker
- Neon Postgres
- Vercel deployment
- Live market data API
- Groq/OpenAI LLM routing
- MCP-style tools
- A2A-style agent coordination

## Design Rule

AI explains and reasons. Deterministic code calculates.

Use deterministic services for:

- asset allocation
- risk score
- target allocation gap
- concentration flags
- forecast bands
- backtest summaries
- scenario simulations

Use AI for:

- user-facing explanations
- investment memo generation
- natural language advisor responses
- summarizing tradeoffs
- asking follow-up questions

