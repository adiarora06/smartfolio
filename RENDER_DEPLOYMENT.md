# SmartFolio Backend Deployment on Render

## Step 1: Create Render Account & Connect GitHub

1. Go to https://render.com
2. Sign up / Log in
3. Connect your GitHub account
4. Authorize Render to access your repositories

---

## Step 2: Create New Web Service

1. Click **"New +"** → **"Web Service"**
2. Select your repository: `adiarora06/smartfolio`
3. Fill in the form:

   | Setting | Value |
   |---------|-------|
   | **Name** | `smartfolio-api` (or your choice) |
   | **Environment** | `Python 3` |
   | **Region** | `Oregon (US West)` (or closest to you) |
   | **Branch** | `main` |
   | **Root Directory** | `backend` |
   | **Build Command** | `pip install -r requirements.txt` |
   | **Start Command** | `uvicorn app.main:app --host 0.0.0.0 --port 8000` |

4. **Instance Type**: Select `Free` (or paid if you want better performance)

---

## Step 3: Add Environment Variables

Click **"Environment"** tab and add these:

```
ANTHROPIC_API_KEY=sk-ant-...
  Description: Claude API key from https://console.anthropic.com

MARKET_DATA_API_KEY=XXXXXXXXX
  Description: Alpha Vantage or Finnhub API key (optional)

MARKET_DATA_PROVIDER=alphavantage
  Description: "alphavantage" or "finnhub"

MARKET_DATA_CACHE_TTL=900
  Description: Cache quotes for 15 min (protects free tier)

MARKET_DATA_TIMEOUT=6
  Description: Network timeout in seconds

LLM_MODEL=claude-opus-4-8
  Description: Which Claude model to use

LLM_MAX_TOKENS=1024
  Description: Max tokens per response

LLM_TIMEOUT=10
  Description: LLM request timeout

DATABASE_URL=postgresql+asyncpg://user:password@host:5432/dbname
  Description: Leave empty for SQLite, or use Neon Postgres (recommended)

SMARTFOLIO_CORS_ORIGINS=http://localhost:5173,https://smartfolio-lemon.vercel.app,https://your-frontend-url.vercel.app
  Description: Comma-separated browser origins allowed to call this API
```

---

## Step 4: (Optional) Add PostgreSQL Database

### Option A: Use Neon (Recommended for Free Tier)

1. Go to https://neon.tech
2. Sign up → Create project
3. Copy connection string (looks like: `postgresql+asyncpg://user:password@ep-xxx.neon.tech/smartfolio`)
4. Paste into Render `DATABASE_URL` environment variable
5. Done! Neon is free for small projects

### Option B: Add Render Postgres Add-on

1. In Render dashboard, click **"Environment"** → **"Add Database"**
2. Select **PostgreSQL**
3. Render auto-fills `DATABASE_URL` env var
4. Costs ~$7/month minimum

---

## Step 5: Deploy

1. Click **"Create Web Service"**
2. Render builds and deploys automatically
3. Wait for status → **"Live"** (takes 2-3 min)
4. Copy your backend URL: `https://smartfolio-api-xxxxx.onrender.com`

---

## Step 6: Update Frontend

1. Go to **Vercel** project settings
2. Environment Variables → Add:
   ```
   VITE_API_URL=https://smartfolio-api-xxxxx.onrender.com
   ```
3. **Re-deploy** frontend (click "Deployments" → "Redeploy")

---

## Step 7: Test

```bash
# Test your backend health check
curl https://smartfolio-api-xxxxx.onrender.com/health

# Should return:
{
  "status": "ok",
  "service": "smartfolio-api",
  "liveMarketData": true/false,
  "llm": true/false,
  "database": "postgres"
}
```

---

## Important Settings Summary

### Build & Start
| Setting | Value |
|---------|-------|
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port 8000` |

### Critical Environment Variables
| Variable | Required? | Example |
|----------|-----------|---------|
| `ANTHROPIC_API_KEY` | No (fallback: templates) | `sk-ant-...` |
| `MARKET_DATA_API_KEY` | No (fallback: offline) | Your Alpha Vantage/Finnhub key |
| `DATABASE_URL` | No (fallback: SQLite) | `postgresql+asyncpg://...` |
| `SMARTFOLIO_CORS_ORIGINS` | Yes | `https://smartfolio-lemon.vercel.app` |

### Optional But Recommended
| Variable | Default | Why Adjust? |
|----------|---------|------------|
| `MARKET_DATA_PROVIDER` | `alphavantage` | Switch to `finnhub` if you prefer |
| `LLM_MODEL` | `claude-opus-4-8` | Use `claude-sonnet-5` for speed, `claude-haiku` for cost |
| `MARKET_DATA_CACHE_TTL` | `900` | Increase if free API tier hits limits |

---

## Monitoring & Logs

1. **Logs**: Dashboard → Click service → **"Logs"** tab
2. **Health**: Click **"Events"** → watch deployment progress
3. **Auto-redeploy**: Every push to `main` redeploys automatically

---

## Troubleshooting

### Service stays in "Deploying" state
- Check Logs tab for build errors
- Make sure `requirements.txt` has all dependencies
- Verify Start Command is correct

### Getting 502 Bad Gateway
- Backend crashed; check Logs
- Often: missing env var or database connection error
- Make sure `DATABASE_URL` is set (even if just SQLite)

### CORS errors in browser console
- Update `SMARTFOLIO_CORS_ORIGINS` to include your frontend URL
- Restart service after changing

### API returns 500 errors
- Check if `ANTHROPIC_API_KEY` is valid (if LLM features used)
- Check if `MARKET_DATA_API_KEY` is valid (if live prices used)
- Both are optional; fallbacks exist

---

## Free Tier Limits

| Component | Free Limit |
|-----------|-----------|
| **Web Service** | 1 free service per month; auto-stops after 15 min inactivity |
| **Postgres Add-on** | Not free (min $7/month) |
| **Bandwidth** | Unlimited |
| **RAM** | 512 MB |
| **CPU** | Shared |

**Tip**: Use Neon (free) instead of Render Postgres to keep costs at $0.

---

## When Ready for Production

Upgrade to:
- **"Pro" plan** ($7/month) - Always on, more resources
- Or use **Railway.app** / **Fly.io** for similar pricing
