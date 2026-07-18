"""Environment configuration.

Everything degrades gracefully: with no market-data key set, the app serves the
offline reference engine exactly as before. Set a free key to get live prices.
"""
from __future__ import annotations

import os


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
    anthropic_api_key: str = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    llm_model: str = os.environ.get("LLM_MODEL", "claude-opus-4-8").strip()
    llm_max_tokens: int = int(os.environ.get("LLM_MAX_TOKENS", "1024"))
    # Per-request LLM timeout (seconds). Kept tight so the UI never stalls long
    # before the template fallback kicks in.
    llm_timeout: float = float(os.environ.get("LLM_TIMEOUT", "10"))

    # Persistence. SQLite file by default (works with zero setup); point at
    # Neon/Postgres via DATABASE_URL (e.g. postgresql+asyncpg://...).
    database_url: str = os.environ.get(
        "DATABASE_URL", "sqlite+aiosqlite:///./data/smartfolio.db"
    )

    @property
    def live_market_data_enabled(self) -> bool:
        return bool(self.market_data_api_key)

    @property
    def llm_enabled(self) -> bool:
        return bool(self.anthropic_api_key)


settings = Settings()
