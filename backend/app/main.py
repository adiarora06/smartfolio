"""SmartFolio API — FastAPI application entry point.

Run locally:
    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from .a2a import router as a2a_router
from .api import router
from .config import settings
from .db import init_db
from .marketdata.resolver import resolver
from .plaid import router as plaid_router
from .ratelimit import limiter
from .workspaces import router as workspaces_router

logger = logging.getLogger("smartfolio.access")

DEFAULT_CORS_ORIGINS = ",".join(
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://smartfolio-lemon.vercel.app",
    ]
)

# Error tracking — activates only when SENTRY_DSN is set (free tier: sentry.io).
if settings.sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(dsn=settings.sentry_dsn, traces_sample_rate=0.1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await resolver.aclose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="SmartFolio API",
        version="0.7.0",
        description=(
            "Deterministic portfolio and stock analysis services plus an AI explanation "
            "layer for SmartFolio. All outputs are educational analysis, not financial advice."
        ),
        lifespan=lifespan,
    )

    # Rate limiting on the endpoints that cost LLM tokens (see ratelimit.py).
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    origins = os.environ.get("SMARTFOLIO_CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in origins if o.strip()],
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-Id"],
    )
    # Analysis responses (forecast + events + memo) are sizeable JSON — compress.
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    @app.middleware("http")
    async def access_log(request: Request, call_next):
        """Structured JSON access log with request ids and latency.

        /health is excluded — keep-warm pings would drown the log stream.
        """
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        t0 = perf_counter()
        response = await call_next(request)
        response.headers["X-Request-Id"] = rid
        if request.url.path not in ("/health", "/favicon.ico"):
            logger.info(
                json.dumps(
                    {
                        "rid": rid,
                        "method": request.method,
                        "path": request.url.path,
                        "status": response.status_code,
                        "ms": round((perf_counter() - t0) * 1000, 1),
                    }
                )
            )
        return response

    @app.get("/", include_in_schema=False)
    def root() -> dict:
        return {"service": "smartfolio-api", "docs": "/docs", "health": "/health"}

    @app.get("/health")
    def health() -> dict:
        return {
            "status": "ok",
            "service": "smartfolio-api",
            "version": app.version,
            "liveMarketData": resolver.live_enabled,
            "marketDataProvider": resolver.provider.name if resolver.provider else "offline",
            "llm": settings.llm_enabled,
            "llmModel": settings.llm_model if settings.llm_enabled else None,
            "llmProvider": settings.llm_provider,
            "llmFallback": bool(settings.openai_api_key and settings.anthropic_api_key),
            "hasOpenAIKey": bool(settings.openai_api_key),
            "hasAnthropicKey": bool(settings.anthropic_api_key),
            "plaid": settings.plaid_enabled,
            "database": "postgres" if settings.is_postgres else "sqlite",
        }

    app.include_router(router)
    app.include_router(workspaces_router)
    app.include_router(plaid_router)
    app.include_router(a2a_router)
    return app


app = create_app()
