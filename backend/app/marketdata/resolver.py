"""Resolver — offline base + optional live overlay, with a small TTL cache."""
from __future__ import annotations

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

    @property
    def live_enabled(self) -> bool:
        return self.provider is not None

    async def resolve(self, ticker: str) -> MarketSnapshot:
        symbol = ticker.strip().upper() or "AAPL"
        cached = self.cache.get(symbol)
        if cached is not None:
            return cached

        snapshot = offline_snapshot(symbol)
        if self.provider is not None:
            try:
                async with httpx.AsyncClient(timeout=settings.market_data_timeout) as client:
                    live = await self.provider.snapshot(client, symbol)
                snapshot = merge(snapshot, live)
            except Exception:
                # Any network/parse failure -> keep the offline base. Never break.
                pass

        self.cache.set(symbol, snapshot)
        return snapshot


# Module-level singleton (provider + cache live for the process lifetime).
resolver = MarketDataResolver()
