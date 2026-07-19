"""Resolver — offline base + optional live overlay, with a small TTL cache.

Perf notes:
- One shared httpx.AsyncClient (keep-alive pool) instead of a client per
  request — saves a TLS handshake on every live quote.
- Per-symbol locks coalesce concurrent fetches for the same ticker so a burst
  of users costs one provider call, not N (protects free-tier budgets).
"""
from __future__ import annotations

import asyncio
import time
from typing import Dict, Optional, Tuple

import httpx

from ..config import settings
from .alphavantage import AlphaVantageProvider
from .base import MarketDataProvider, MarketSnapshot, merge
from .finnhub import FinnhubProvider
from .offline import offline_snapshot


class _TTLCache:
    def __init__(self, ttl: float) -> None:
        self.ttl = ttl
        self._store: Dict[str, Tuple[float, MarketSnapshot]] = {}

    def get(self, key: str) -> Optional[MarketSnapshot]:
        entry = self._store.get(key)
        if not entry:
            return None
        expires, value = entry
        if time.time() > expires:
            self._store.pop(key, None)
            return None
        return value

    def set(self, key: str, value: MarketSnapshot) -> None:
        self._store[key] = (time.time() + self.ttl, value)


def _build_provider() -> Optional[MarketDataProvider]:
    if not settings.live_market_data_enabled:
        return None
    if settings.market_data_provider == "finnhub":
        return FinnhubProvider(settings.market_data_api_key)
    return AlphaVantageProvider(settings.market_data_api_key)


class MarketDataResolver:
    def __init__(self) -> None:
        self.provider = _build_provider()
        self.cache = _TTLCache(settings.market_data_cache_ttl)
        self._client: Optional[httpx.AsyncClient] = None
        self._locks: Dict[str, asyncio.Lock] = {}

    @property
    def live_enabled(self) -> bool:
        return self.provider is not None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=settings.market_data_timeout,
                limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()

    async def resolve(self, ticker: str) -> MarketSnapshot:
        symbol = ticker.strip().upper() or "AAPL"
        cached = self.cache.get(symbol)
        if cached is not None:
            return cached

        # Coalesce concurrent fetches for the same symbol into one provider call.
        lock = self._locks.setdefault(symbol, asyncio.Lock())
        async with lock:
            cached = self.cache.get(symbol)  # another waiter may have filled it
            if cached is not None:
                return cached

            snapshot = offline_snapshot(symbol)
            if self.provider is not None:
                try:
                    live = await self.provider.snapshot(self._get_client(), symbol)
                    snapshot = merge(snapshot, live)
                except Exception:
                    # Any network/parse failure -> keep the offline base. Never break.
                    pass

            self.cache.set(symbol, snapshot)
            return snapshot


# Module-level singleton (provider + cache live for the process lifetime).
resolver = MarketDataResolver()
