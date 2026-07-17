# Claude Code Instructions For SmartFolio

This vault is project memory for SmartFolio.

The deployable source code lives in the parent repo:

```text
/Users/adiarora/Documents/Codex/2026-07-06/so-i-have-this-right-uses
```

## Read First

Start with:

- `00 Home.md`
- `01 Project Overview.md`
- `02 Architecture.md`
- `03 Agent System.md`
- `04 Analyze Stock.md`
- `05 Portfolio Intelligence.md`
- `10 Implementation Roadmap.md`
- `11 Data Model.md`
- `12 AI Architecture Decisions.md`

## Project Goal

SmartFolio should become a resume-ready AI investment intelligence platform with:

- guided investor onboarding
- portfolio diagnostics
- OpenVC-style Analyze Stock terminal
- scenario modeling
- AI advisor
- connected app architecture
- A2A-style agents
- MCP-style tools

## Engineering Direction

Prefer this production architecture:

- React or Next.js frontend
- Python FastAPI backend
- Pydantic models
- Neon Postgres
- market data API integration
- LLM provider routing
- Docker
- tests
- Vercel deployment

## Important Rule

Deterministic code handles financial calculations.

AI handles:

- explanation
- summarization
- memo generation
- natural language advisor behavior

Do not make guaranteed financial claims.

## When Coding

If asked to implement code, edit the parent project repo, not only the vault notes.

Keep the vault updated when major architecture or product decisions change.
