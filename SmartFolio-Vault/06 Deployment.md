# Deployment

## Live Demo

https://smartfolio-lemon.vercel.app/

## GitHub Repo

https://github.com/adiarora06/smartfolio

## Current Deployment

The live Vercel site is the React/Vite application built from `frontend/`.
The superseded root `index.html` prototype was removed after the production
deployment was verified; its history remains available in Git.

## Deployment topology (configured 2026-07-17)

Frontend and backend deploy separately — see the full walkthrough in
`DEPLOYMENT.md` at the repo root.

- **Frontend → Vercel.** Root `vercel.json` builds `frontend/` and serves
  `frontend/dist` (SPA rewrite included), so no dashboard Root Directory change
  is required. Set `VITE_API_URL` (build-time) to the backend URL.
- **Backend → Render (free).** `render.yaml` blueprint (rootDir `backend`,
  `uvicorn app.main:app`). Also a portable `backend/Dockerfile` for Render
  Docker / Railway / Fly / local — **verified: image builds, honors `$PORT`, and
  serves live data**. Secrets (`MARKET_DATA_API_KEY`, `SMARTFOLIO_CORS_ORIGINS`)
  set in the host dashboard, never committed.

### Order of operations (chicken-and-egg)

Backend first (get its URL) → set `VITE_API_URL` in Vercel + redeploy → set
`SMARTFOLIO_CORS_ORIGINS` to the Vercel URL on Render + redeploy.

### Will `git push` auto-update Vercel?

Yes, if the Vercel project is linked to the GitHub repo (it is). The root
`vercel.json` builds the React app from `frontend/`; the Python backend does
**not** run on Vercel — it must be deployed to Render/etc., or the frontend
silently falls back to its offline engine (no live prices).

### Known free-tier caveat

Render free instances sleep when idle; a cold start (30–60s) can exceed the
frontend's 5s API timeout, so the first load after idle may show offline until
the backend wakes. Mitigate with a keep-warm ping or a paid instance.

## Roadmap Beyond This

Still ahead (see [[15 Improvement Design]], milestone M5): rate limiting,
structured logging, CI, a custom domain, and Neon Postgres for persistence
(M2). Auth remains an explicit non-goal for now.
