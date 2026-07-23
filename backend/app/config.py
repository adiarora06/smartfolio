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
    # Market data. provider is one of: "alphavantage", "finnhub". This is the
    # QUOTE provider — the fast, high-quota source for the live spot price.
    # No key -> offline-only (today's behavior).
    market_data_provider: str = os.environ.get("MARKET_DATA_PROVIDER", "alphavantage").strip().lower()
    market_data_api_key: str = os.environ.get("MARKET_DATA_API_KEY", "").strip()

    # Hybrid deep-data key. Finnhub's free tier serves fast quotes but no
    # historical candles; Alpha Vantage's free tier serves daily history +
    # fundamentals but only ~25 requests/day. Setting ALPHAVANTAGE_API_KEY
    # alongside a Finnhub MARKET_DATA_API_KEY runs BOTH: Finnhub answers the
    # frequent quote calls, and Alpha Vantage's scarce budget is spent only on
    # the history + fundamentals Finnhub can't provide. When the quote provider
    # is already alphavantage this is unnecessary (the deep path reuses that key).
    alphavantage_api_key: str = os.environ.get("ALPHAVANTAGE_API_KEY", "").strip()
    # Cache live quotes for this many seconds to protect free-tier request budgets.
    market_data_cache_ttl: float = float(os.environ.get("MARKET_DATA_CACHE_TTL", "900"))
    # Per-request network timeout to a market-data provider (seconds). Deep
    # analysis pulls a multi-year daily series, which is a far larger payload
    # than a quote, so it gets its own (longer) budget.
    market_data_timeout: float = float(os.environ.get("MARKET_DATA_TIMEOUT", "12"))

    # Deep analysis: pull daily history + fundamentals, not just a quote. Costs
    # ~3 provider requests per uncached ticker against Alpha Vantage's ~25/day
    # free tier, which the Postgres-backed cache in marketdata/cache.py spreads
    # across restarts. Set DEEP_ANALYSIS=0 to run quote-only.
    deep_analysis: str = os.environ.get("DEEP_ANALYSIS", "1").strip()
    # News sentiment is the least load-bearing input and the easiest to drop
    # when the request budget is tight.
    sentiment: str = os.environ.get("NEWS_SENTIMENT", "1").strip()

    # Walk-forward backtest: how many past origins to replay, and the minimum
    # observations required before the engine will report one at all.
    backtest_origins: int = int(os.environ.get("BACKTEST_ORIGINS", "24"))
    backtest_min_observations: int = int(os.environ.get("BACKTEST_MIN_OBS", "180"))

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

    # Plaid brokerage sync. Free sandbox keys: https://dashboard.plaid.com
    # No keys -> the Connections card stays a demo toggle.
    plaid_client_id: str = os.environ.get("PLAID_CLIENT_ID", "").strip()
    plaid_secret: str = os.environ.get("PLAID_SECRET", "").strip()
    plaid_env: str = os.environ.get("PLAID_ENV", "sandbox").strip().lower()

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
    def deep_api_key(self) -> str:
        """The Alpha Vantage key for the deep path (history + fundamentals).

        An explicit ALPHAVANTAGE_API_KEY wins (the hybrid case: Finnhub quotes
        + AV deep). Otherwise, when the quote provider is itself Alpha Vantage,
        the deep path reuses the primary key. Anything else -> no deep key.
        """
        if self.alphavantage_api_key:
            return self.alphavantage_api_key
        if self.market_data_provider == "alphavantage":
            return self.market_data_api_key
        return ""

    @property
    def deep_analysis_enabled(self) -> bool:
        return bool(self.deep_api_key) and self.deep_analysis not in {"0", "false", "no"}

    @property
    def sentiment_enabled(self) -> bool:
        return self.deep_analysis_enabled and self.sentiment not in {"0", "false", "no"}

    @property
    def llm_enabled(self) -> bool:
        return bool(self.anthropic_api_key or self.openai_api_key)

    @property
    def plaid_enabled(self) -> bool:
        return bool(self.plaid_client_id and self.plaid_secret)


settings = Settings()
