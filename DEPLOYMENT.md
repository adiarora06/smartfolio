# Deploying SmartFolio

The repo is a monorepo:

- `frontend/` — React/Vite SPA → **Vercel**
- `backend/` — FastAPI service → **Render** (or any Python host)
- `index.html` — the original static prototype (superseded; kept for history)

The frontend works on its own — with no backend it falls back to the built-in
offline engine (every screen works, prices show as "offline reference"). Live
prices need the backend + a market-data key.

There is a chicken-and-egg between the two (the frontend needs the backend URL;
the backend's CORS needs the frontend URL), so deploy the **backend first**.

---

## 0. Commit & push

The new code is not committed yet. From the repo root:

```bash
git checkout -b feature/react-fastapi
git add frontend backend vercel.json render.yaml DEPLOYMENT.md README.md SmartFolio-Vault
git commit -m "Add React frontend + FastAPI backend with live market data"
git push -u origin feature/react-fastapi
```

Merge to `main` when ready (Vercel auto-deploys the branch it's configured to
track — usually `main`).

---

## 1. Backend → Render (free)

1. Push the repo (above).
2. Render dashboard → **New + → Blueprint** → select this repo. It reads
   [`render.yaml`](render.yaml) and provisions `smartfolio-api`
   (rootDir `backend`, `uvicorn app.main:app`).
   - *Manual alternative:* New → Web Service → root directory `backend`, build
     `pip install -r requirements.txt`, start
     `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
3. Set env vars in the Render dashboard (they're marked `sync: false`):
   - `MARKET_DATA_API_KEY` = your free key
     ([Alpha Vantage](https://www.alphavantage.co/support/#api-key) or
     [Finnhub](https://finnhub.io/register)).
   - `SMARTFOLIO_CORS_ORIGINS` = your Vercel URL (fill in after step 2; start
     with `https://smartfolio-lemon.vercel.app` if reusing the domain).
4. Deploy. Confirm: `https://<your-service>.onrender.com/health` returns
   `"liveMarketData": true`. Copy this base URL.

> Docker alternative: [`backend/Dockerfile`](backend/Dockerfile) works on Render
> (Docker runtime), Railway, Fly.io, or locally (`docker build -t smartfolio-api
> backend && docker run -p 8000:8000 -e MARKET_DATA_API_KEY=... smartfolio-api`).

---

## 2. Frontend → Vercel

The root [`vercel.json`](vercel.json) already tells Vercel to build `frontend/`
and serve `frontend/dist` — **no dashboard "Root Directory" change needed**.

1. Vercel project → **Settings → Environment Variables** → add
   `VITE_API_URL` = the Render URL from step 1 (Production scope).
2. Redeploy (Deployments → ⋯ → Redeploy). `VITE_API_URL` is inlined at **build
   time**, so it only takes effect on a fresh build.
3. Copy the resulting Vercel URL.

> Cleaner alternative: set **Root Directory = `frontend`** in Vercel settings and
> delete the `installCommand`/`buildCommand`/`outputDirectory` from the root
> `vercel.json` (Vercel auto-detects Vite). Either approach works.

---

## 3. Close the CORS loop

Put the Vercel URL from step 2 into Render's `SMARTFOLIO_CORS_ORIGINS` and
redeploy the backend. (Comma-separate multiple origins, e.g. the `.vercel.app`
domain plus any custom domain.)

---

## 4. Verify

Open the Vercel URL → **Analyze Stock** → **Run Analysis**. You should see
`● Live price · alphavantage · <date>` and a real price. Connections shows the
SmartFolio API card as **Live**.

---

## Known caveats (free tier)

- **Cold starts.** Render's free instance sleeps when idle; the first request can
  take 30–60s. The frontend's API timeout is 5s, so the first load after idle may
  show offline until the backend wakes, then recover on the next interaction.
  Mitigate with a keep-warm ping (e.g. a cron hitting `/health`) or a paid instance.
- **`VITE_API_URL` is build-time.** Changing it in Vercel requires a redeploy.
- **Market-data quotas.** Alpha Vantage free = 25 req/day; the in-process cache
  (15 min) softens this. Finnhub free = 60 req/min if you need more headroom.
- **Rate limiting / logging / custom domain** are not set up yet — see the M5
  milestone in `SmartFolio-Vault/15 Improvement Design.md`.
