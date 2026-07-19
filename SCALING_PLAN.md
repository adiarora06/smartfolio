# SmartFolio — Scale & Full-Scale Deployment Plan

Current state (v0.4.0, live): Vercel frontend + Render free-tier FastAPI + Neon Postgres + Finnhub + OpenAI gpt-4o-mini. This plan takes it from "working demo" to "production platform" in four phases. Each phase is independently shippable.

---

## Optimizations Already Implemented (v0.4.0)

| Optimization | Impact |
|---|---|
| Shared `httpx.AsyncClient` (keep-alive pool) | No TLS handshake per quote fetch (~100-300ms saved per uncached analysis) |
| Per-symbol fetch coalescing | Burst of N users on one ticker = 1 provider call, not N |
| `pool_pre_ping` + recycle on Postgres | No 500s after Neon autosuspend kills idle connections |
| Bounded DB pool (5 + 5 overflow) | Stays under Neon free-tier connection limits |
| GZip middleware | Analysis JSON payloads shrink ~70-85% on the wire |
| BackgroundTasks persistence | `/stocks/analyze` responds without waiting on the DB write |
| In-process TTL quote cache (15 min) | Protects free-tier API budgets; instant repeat lookups |

---

## Phase 1 — Production Hardening (1-2 days)

Goal: safe to put in front of strangers.

1. **Rate limiting** — `slowapi` middleware; e.g. 30 req/min per IP on `/stocks/analyze` and `/advisor/ask` (they cost LLM tokens), 120 req/min elsewhere. Protects the OpenAI bill.
2. **Structured logging + request IDs** — JSON logs with latency per request; `X-Request-Id` echoed to clients. Free observability on Render's log stream.
3. **Error tracking** — Sentry free tier (`sentry-sdk[fastapi]`, one env var: `SENTRY_DSN`). Right now exceptions vanish into `except Exception: pass` blocks.
4. **CI** — GitHub Actions: on PR run `ruff` + `pytest` (backend) and `tsc` + `npm run build` (frontend). Block merge on red.
5. **Tests** — pytest + TestClient covering: health, workspace CRUD round-trip, analyze with/without workspace header, compliance rejection path, DB URL normalizer. (~15 tests, the skeleton already proved out locally.)
6. **Keep-warm** — Render free tier sleeps after 15 min. A GitHub Actions cron hitting `/health` every 10 min keeps the demo snappy for recruiters, or upgrade to Starter ($7/mo) and delete the hack.

## Phase 2 — Real Scale Foundations (1 week)

Goal: survive 10-100x traffic without re-architecture.

1. **Redis cache layer** (Upstash free tier) — move the quote TTL cache + add LLM response caching keyed on `(endpoint, model, context-hash)`. Two Render instances then share one cache; repeated identical advisor questions cost $0.
2. **Alembic migrations** — replace `create_all` with versioned migrations. Required before any schema change on live Postgres data.
3. **Horizontal scaling** — Render Starter + 2 instances behind its LB. The app is already stateless (state in Postgres, cache moving to Redis), so this is a dial, not a project.
4. **Auth** — Clerk or Auth0 free tier on the frontend; backend validates JWTs, workspaces gain `owner_id`. Anonymous workspaces keep working (progressive enhancement: sign in to sync across devices).
5. **DB indexes at scale** — composite `(workspace_id, created_at desc)` on `stock_runs` and `memos` once history grows.
6. **LLM budget controls** — per-workspace daily token quota tracked in Redis; degrade to template narration when exhausted (fallback already exists — this is just the trigger).

## Phase 3 — Platform Maturity (2-4 weeks)

1. **Docker** — multi-stage Dockerfile for the backend; same image locally, in CI, and deployed. Unlocks moving to Fly.io / Railway / AWS without changes.
2. **Streaming AI responses** — SSE for advisor answers (`stream=True` on both providers); perceived latency drops from ~3s to ~300ms first-token.
3. **WebSocket price ticker** — push live quotes to open Analyze screens instead of polling.
4. **Batch/queued jobs** — background scheduler (or worker + Redis queue) for portfolio re-scans, so the request path never runs long jobs.
5. **Observability** — OpenTelemetry traces (FastAPI auto-instrumentation) exported to Grafana Cloud free tier; latency dashboards per endpoint and per agent step (the `AgentEvent` durations are already collected — export them).
6. **Multi-provider LLM failover** — you already have both SDK paths; add ordered fallback (OpenAI → Anthropic → template) instead of single-provider selection.

## Phase 4 — Full-Scale Architecture (when there's real traffic)

Target shape:

```
Cloudflare (CDN/WAF)
  → Vercel (frontend)
  → API on Fly.io/AWS (3+ containers, autoscale on CPU)
      → Upstash Redis (cache, quotas, queues)
      → Neon Postgres (autoscaling, read replicas)
      → Provider pool: Finnhub + AlphaVantage failover
      → LLM router: OpenAI ↔ Anthropic with health-based failover
  → Worker fleet (queue consumers: memos, re-scans, digests)
```

- **Neon branching** for preview environments — every PR gets its own DB branch wired to a Render/Fly preview deploy.
- **Blue-green deploys** with health-gated cutover.
- **Load testing** with k6 in CI (`p95 < 500ms` on cached analyze as the regression gate).
- **Cost model at 10k MAU**: ~$25-50/mo (API hosting) + ~$19 Neon + ~$10 Upstash + LLM usage (gpt-4o-mini keeps 100k advisor calls ≈ $30).

---

## Deployment Runbook (current stack)

| Action | How |
|---|---|
| Deploy backend | `git push` → Render auto-deploys `backend/` |
| Deploy frontend | `git push` → Vercel auto-builds `frontend/` |
| Verify | `curl https://smartfolio-api-yjcj.onrender.com/health` — check `version`, `llm: true`, `database: postgres` |
| Rollback | Render → Events → "Rollback" on a previous deploy (or `git revert` + push) |
| Env change | Render → Environment → save → **Manual Deploy** (env changes don't auto-redeploy) |

## Priority Order (my recommendation)

1. Rate limiting (protects your OpenAI bill — do this before sharing the link widely)
2. Sentry + structured logging (you can't fix what you can't see)
3. CI + tests (everything after this compounds faster)
4. Keep-warm or $7 Starter (demo UX)
5. Redis + Alembic (the scale foundations)
6. Everything else as traffic justifies it
