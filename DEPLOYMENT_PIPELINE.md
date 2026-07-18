# SmartFolio Deployment Pipeline & Environment Setup

## CI/CD Pipeline Overview

### Vercel Frontend Deployment
- **Trigger**: Push to `main` branch
- **Build**: `cd frontend && npm run build`
- **Output**: `frontend/dist`
- **Rewrite**: All routes → `/index.html` (SPA routing)
- **URL**: https://smartfolio-lemon.vercel.app

### Backend Deployment
- **Current**: Manual deployment to Render/Railway (or local uvicorn)
- **Runtime**: Python 3.9+
- **Framework**: FastAPI with async SQLAlchemy
- **Package Manager**: pip
- **Start**: `uvicorn app.main:app`

---

## Environment Variables Required

### Backend (.env or platform env vars)

#### Market Data Integration
```
MARKET_DATA_PROVIDER=alphavantage
  # Options: "alphavantage" or "finnhub"
  # Default: alphavantage
  
MARKET_DATA_API_KEY=<your_key_here>
  # Optional. Leave blank for offline-only mode.
  # Alpha Vantage: https://www.alphavantage.co/support/#api-key
  # Finnhub: https://finnhub.io/register
  # Free tiers: ~500 req/day (Alpha Vantage), ~60 req/min (Finnhub)
  
MARKET_DATA_CACHE_TTL=900
  # Seconds to cache quotes in-process
  # Default: 900 (15 min)
  
MARKET_DATA_TIMEOUT=6
  # Per-request network timeout (seconds)
  # Default: 6
```

#### AI / LLM Integration
```
ANTHROPIC_API_KEY=<your_key_here>
  # Optional. Claude API key from https://console.anthropic.com
  # Without this: deterministic template fallback
  # Required for: advisor, memo generation, analysis explanations
  
LLM_MODEL=claude-opus-4-8
  # Default: claude-opus-4-8
  # Alternatives: claude-sonnet-5, claude-haiku-4-5
  
LLM_MAX_TOKENS=1024
  # Default: 1024
  
LLM_TIMEOUT=10
  # Per-request LLM timeout (seconds)
  # Default: 10
```

#### Database
```
DATABASE_URL=sqlite+aiosqlite:///./data/smartfolio.db
  # Default: SQLite (zero setup)
  # Production: Use Neon Postgres
  #   Format: postgresql+asyncpg://user:password@host:port/dbname
  #   Example: postgresql+asyncpg://user:pw@ep-xxx.neon.tech/smartfolio
```

#### CORS
```
SMARTFOLIO_CORS_ORIGINS=http://localhost:5173,https://smartfolio-lemon.vercel.app
  # Comma-separated browser origins allowed to call this API
  # Update when adding new frontend domains
```

---

### Frontend (.env or Vercel project settings)

```
VITE_API_URL=
  # Optional. Backend API URL.
  # Local dev: Leave unset (defaults to http://localhost:8000)
  # Production: Set to deployed backend URL, e.g. https://smartfolio-api.onrender.com
  # NOTE: This is inlined at BUILD TIME, so redeploy after changing in Vercel
```

---

## Setup Instructions

### Local Development

1. **Backend Setup**
   ```bash
   cd backend
   cp .env.example .env
   # Edit .env with your API keys
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```

2. **Frontend Setup**
   ```bash
   cd frontend
   cp .env.example .env
   # Edit .env if needed (usually leave VITE_API_URL blank)
   npm install
   npm run dev  # Runs on http://localhost:5173
   ```

### Vercel Deployment (Frontend)

1. Connect GitHub repo to Vercel
2. Set environment variables in Vercel project settings:
   - `VITE_API_URL` → your backend deployment URL

3. Vercel auto-deploys on push to `main`
   - Build runs: `cd frontend && npm run build`
   - Output served from: `frontend/dist`

### Render/Railway Deployment (Backend)

1. Create new Web Service, select GitHub repo
2. Set Start Command: `uvicorn app.main:app --host 0.0.0.0 --port 8000`
3. Add Environment Variables:
   ```
   ANTHROPIC_API_KEY=...
   MARKET_DATA_API_KEY=...
   MARKET_DATA_PROVIDER=alphavantage
   DATABASE_URL=postgresql+asyncpg://...  (use Neon)
   SMARTFOLIO_CORS_ORIGINS=http://localhost:5173,https://smartfolio-lemon.vercel.app,<your-vercel-url>
   ```
4. Deploy and grab the backend URL
5. Update `VITE_API_URL` in Vercel frontend settings with backend URL
6. Trigger Vercel redeploy

---

## Health Check Endpoint

```bash
GET /health
```

Response includes:
- Service status
- API version
- Live market data enabled (boolean)
- Market data provider name
- LLM enabled (boolean)
- LLM model in use
- Database type (sqlite vs postgres)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Browser (Vercel)                                             │
│ https://smartfolio-lemon.vercel.app                          │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ React + Vite + TypeScript                                │ │
│ │ - Portfolio analysis (deterministic)                      │ │
│ │ - Stock research                                          │ │
│ │ - AI advisor (Claude)                                     │ │
│ │ - Workspace management                                    │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────┬───────────────────────────────────────────┘
                   │ VITE_API_URL (REST + JSON)
                   ▼
┌──────────────────────────────────────────────────────────────┐
│ FastAPI Backend (Render/Railway/local)                       │
│ POST /analyze-stock, /advisor, /workspace/*                  │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Orchestrator (agent coordination)                         │ │
│ │ - LLM routing (Anthropic, OpenAI, local)                 │ │
│ │ - Tool invocation (analysis, compliance, memo gen)        │ │
│ │ - Deterministic fallbacks (no LLM required)              │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Services Layer                                            │ │
│ │ - Market Data (Alpha Vantage / Finnhub)                  │ │
│ │ - AI Services (Insights, Compliance, Memo)               │ │
│ │ - Impact Calculations                                     │ │
│ │ - Workspace Management                                    │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Database Layer (SQLAlchemy async)                         │ │
│ │ - SQLite (dev) or Neon Postgres (prod)                   │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## What Needs to Be Added

### Immediate (MVP)

- [ ] **Neon Postgres Setup**
  - Create free tier at https://neon.tech
  - Use `DATABASE_URL` from Neon
  - Run migrations (if any)

- [ ] **API Keys for Production**
  - Alpha Vantage / Finnhub for live market data (optional)
  - Anthropic API key for Claude integration
  - Add to Render/Railway environment

- [ ] **Backend Deployment**
  - Deploy to Render.com or Railway.app
  - Grab backend URL
  - Update Vercel `VITE_API_URL` env var
  - Trigger frontend redeploy

- [ ] **CORS Origins**
  - Update `SMARTFOLIO_CORS_ORIGINS` with production frontend URL

### Future (Post-MVP)

- [ ] Automated test suite (pytest for backend, Vitest for frontend)
- [ ] GitHub Actions CI/CD pipeline
- [ ] Docker containerization for backend
- [ ] Rate limiting middleware
- [ ] Analytics & error tracking (Sentry)
- [ ] WebSocket support for real-time market data
- [ ] Workspace multi-tenancy enforcement
- [ ] User authentication & authorization
- [ ] Payment processing (for premium tiers)

---

## Commands Cheat Sheet

```bash
# Local backend
uvicorn app.main:app --reload --port 8000

# Local frontend
npm run dev

# Format Python code
black app/

# Type check Python
mypy app/

# Frontend type check
npm run type-check

# Frontend build
npm run build

# Frontend preview (test built dist)
npm run preview
```

---

## Monitoring & Debugging

### Backend Logs
- **Vercel**: Vercel Logs tab
- **Render**: Logs tab in dashboard
- **Local**: Console output from uvicorn

### Frontend
- Vercel: Analytics & Deployments tabs
- Local: Browser DevTools

### Health Check
```bash
curl https://<backend-url>/health
```

Should return:
```json
{
  "status": "ok",
  "service": "smartfolio-api",
  "version": "0.3.0",
  "liveMarketData": true/false,
  "marketDataProvider": "alphavantage",
  "llm": true/false,
  "llmModel": "claude-opus-4-8",
  "database": "postgres"
}
```
