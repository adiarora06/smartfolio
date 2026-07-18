"""SmartFolio API — FastAPI application entry point.

Run locally:
    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router
from .config import settings
from .db import init_db
from .marketdata.resolver import resolver
from .workspaces import router as workspaces_router

DEFAULT_CORS_ORIGINS = ",".join(
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://smartfolio-lemon.vercel.app",
    ]
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="SmartFolio API",
        version="0.3.0",
        description=(
            "Deterministic portfolio and stock analysis services plus an AI explanation "
            "layer for SmartFolio. All outputs are educational analysis, not financial advice."
        ),
        lifespan=lifespan,
    )

    origins = os.environ.get("SMARTFOLIO_CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in origins if o.strip()],
        allow_methods=["*"],
        allow_headers=["*"],
    )

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
            "database": "postgres" if "postgres" in settings.database_url else "sqlite",
        }

    app.include_router(router)
    app.include_router(workspaces_router)
    return app


app = create_app()
