# AI Architecture Decisions

## Best Architecture Choice

Use an agentic service architecture:

- A2A-style agent orchestration for collaboration between specialized agents.
- RAG for grounding AI answers in user profile data, portfolio history, market news, filings, and internal project memory.
- MCP-style connectors for external applications and tools.
- Deterministic financial services for math, forecasts, scoring, and backtesting.
- LLM routing for memo generation, explanation, summarization, and user-facing advisor behavior.

This is stronger than a single chatbot because it lets SmartFolio show real system design: data ingestion, typed APIs, agent coordination, persistence, evaluation, and deployment.

## Use AI For

- profile interpretation
- natural language Q&A
- investment memo generation
- news synthesis
- portfolio explanation
- agent collaboration
- scenario narration
- document summarization

## Do Not Use AI For

- raw return calculations
- portfolio allocation math
- risk score formulas
- price lookups
- database writes without validation
- guaranteed financial claims

## Best Resume Positioning

SmartFolio should be positioned as:

> An agentic AI investment intelligence platform combining portfolio diagnostics, stock analysis, multi-agent orchestration, RAG-grounded financial reasoning, and cloud-native deployment.

## Why This Beats A Simple OpenVC Clone

OpenVC-style stock analysis is one feature. SmartFolio becomes stronger when it combines:

- investor onboarding
- personal portfolio context
- stock analysis
- historical backtesting
- AI-generated memos
- agent traces
- persistent memory
- connected apps

That makes the project feel like a platform, not just a ticker lookup demo.

