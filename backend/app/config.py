"""Environment configuration.

Everything degrades gracefully: with no market-data key set, the app serves the
offline reference engine exactly as before. Set a free key to get live prices.
"""
from __future__ import annotations

import os
from urllib.parse import urlsplit, urlunsplit


def _normalize_db_url(url: str) -> str:
    """Make common Postgres URLs (e.g. Neon) work with async SQLAlchemy.

    - postgres:// and postgresql:// -> postgresql+asyncpg://
    - Strip query params asyncpg can't parse (sslmode, channel_binding).
      SSL is enabled separately via connect_args in db.py.
    Leaves sqlite (or already-correct) URLs untouched.
    """
    url = url.strip()
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]

    if url.startswith("postgresql+asyncpg://"):
        parts = urlsplit(url)
        # Drop query entirely — SSL handled via connect_args, other params
        # (sslmode/channel_binding) are psycopg-only and break asyncpg.
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    return url


class Settings:
    # Market data. provider is one of: "alphavantage", "finnhub".
    # No key -> offline-only (today's behavior).
    market_data_provider: str = os.environ.get("MARKET_DATA_PROVIDER", "alphavantage").strip().lower()
    market_data_api_key: str = os.environ.get("MARKET_DATA_API_KEY", "").strip()
    # Cache live quotes for this many seconds to protect free-tier request budgets.
    market_data_cache_ttl: float = float(os.environ.get("MARKET_DATA_CACHE_TTL", "900"))
    # Per-request network timeout to a market-data provider (seconds).
    market_data_timeout: float = float(os.environ.get("MARKET_DATA_TIMEOUT", "6"))

    # LLM routing (AI explanation layer). No key -> deterministic templates.
    llm_provider: str = os.environ.get("LLM_PROVIDER", "anthropic").strip().lower()
    anthropic_api_key: str = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    openai_api_key: str = os.environ.get("OPENAI_API_KEY", "").strip()
    llm_model: str = os.environ.get("LLM_MODEL", "gpt-4o-mini" if os.environ.get("OPENAI_API_KEY") else "claude-opus-4-8").strip()
    llm_max_tokens: int = int(os.environ.get("LLM_MAX_TOKENS", "1024"))
    # Per-request LLM timeout (seconds). Kept tight so the UI never stalls long
    # before the template fallback kicks in.
    llm_timeout: float = float(os.environ.get("LLM_TIMEOUT", "10"))

    # Error tracking. Set SENTRY_DSN (free tier: sentry.io) to activate;
    # blank -> no-op, zero overhead.
    sentry_dsn: str = os.environ.get("SENTRY_DSN", "").strip()

    # Persistence. SQLite file by default (works with zero setup); point at
    # Neon/Postgres via DATABASE_URL (e.g. postgresql+asyncpg://...).
    database_url: str = _normalize_db_url(
        os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./data/smartfolio.db")
    )

    @property
    def is_postgres(self) -> bool:
        return "postgresql" in self.database_url

    @property
    def live_market_data_enabled(self) -> bool:
        return bool(self.market_data_api_key)

    @property
    def llm_enabled(self) -> bool:
        return bool(self.anthropic_api_key or self.openai_api_key)


settings = Settings()
