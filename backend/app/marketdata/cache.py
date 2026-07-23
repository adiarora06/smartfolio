"""Two-tier cache for provider payloads: in-process, then Postgres.

Why both: the in-process layer keeps a hot ticker free within a request burst,
and the database layer survives the restarts that a free-tier Render instance
does constantly. Without the second tier the Alpha Vantage daily budget is gone
by mid-morning.

Every operation is best-effort. A database that is asleep, missing, or
misconfigured degrades this to an in-memory cache — it never fails an analysis.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import delete, select

from ..db import MarketCacheRow, SessionLocal

# Per-function freshness. History changes once a trading day; fundamentals are
# quarterly filings and move far more slowly; sentiment is the fastest-moving
# but also the least load-bearing input, so it gets the shortest life.
TTL_SECONDS: Dict[str, float] = {
    "quote": 900,  # 15 min
    "daily": 86_400,  # 1 day
    "overview": 604_800,  # 7 days
    "finnhub_fundamentals": 604_800,  # 7 days (fallback fundamentals source)
    "sentiment": 21_600,  # 6 hours
}
DEFAULT_TTL = 3600.0


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def _key(symbol: str, function: str) -> str:
    return f"{symbol.upper()}:{function}"


class _MemoryTier:
    def __init__(self) -> None:
        self._store: Dict[str, Tuple[float, Dict[str, Any]]] = {}

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        entry = self._store.get(key)
        if not entry:
            return None
        expires, payload = entry
        if time.time() > expires:
            self._store.pop(key, None)
            return None
        return payload

    def set(self, key: str, payload: Dict[str, Any], ttl: float) -> None:
        self._store[key] = (time.time() + ttl, payload)


_memory = _MemoryTier()


async def get(symbol: str, function: str) -> Optional[Dict[str, Any]]:
    """Cached payload for (symbol, function), or None when absent/expired."""
    key = _key(symbol, function)
    hit = _memory.get(key)
    if hit is not None:
        return hit

    try:
        async with SessionLocal() as session:
            row = await session.get(MarketCacheRow, key)
            if row is None:
                return None
            if row.expires_at <= _iso(_now()):
                return None
            payload = row.payload
            if not isinstance(payload, dict):
                return None
            # Re-warm the memory tier for the remainder of the row's life.
            remaining = max(
                0.0,
                (
                    datetime.fromisoformat(row.expires_at) - _now()
                ).total_seconds(),
            )
            if remaining > 0:
                _memory.set(key, payload, remaining)
            return payload
    except Exception:
        return None


async def put(symbol: str, function: str, payload: Dict[str, Any]) -> None:
    """Store a payload in both tiers. Never raises."""
    key = _key(symbol, function)
    ttl = TTL_SECONDS.get(function, DEFAULT_TTL)
    _memory.set(key, payload, ttl)

    now = _now()
    try:
        async with SessionLocal() as session:
            row = await session.get(MarketCacheRow, key)
            if row is None:
                session.add(
                    MarketCacheRow(
                        key=key,
                        symbol=symbol.upper(),
                        function=function,
                        payload=payload,
                        fetched_at=_iso(now),
                        expires_at=_iso(now + timedelta(seconds=ttl)),
                    )
                )
            else:
                row.payload = payload
                row.fetched_at = _iso(now)
                row.expires_at = _iso(now + timedelta(seconds=ttl))
            await session.commit()
    except Exception:
        # Cache writes are an optimisation, never a correctness requirement.
        pass


async def stale(symbol: str, function: str) -> Optional[Dict[str, Any]]:
    """An expired payload, ignoring its TTL.

    The backstop for a throttled provider: last week's fundamentals beat a
    hash-derived guess, so long as the UI reports the data as stale.
    """
    try:
        async with SessionLocal() as session:
            row = await session.get(MarketCacheRow, _key(symbol, function))
            if row is None or not isinstance(row.payload, dict):
                return None
            return row.payload
    except Exception:
        return None


async def purge_expired(older_than_days: int = 30) -> int:
    """Drop long-dead rows so the cache table cannot grow without bound."""
    cutoff = _iso(_now() - timedelta(days=older_than_days))
    try:
        async with SessionLocal() as session:
            result = await session.execute(
                delete(MarketCacheRow).where(MarketCacheRow.expires_at < cutoff)
            )
            await session.commit()
            return result.rowcount or 0
    except Exception:
        return 0


async def entries(symbol: str) -> Dict[str, str]:
    """Which functions are cached for a symbol, and until when (for /health)."""
    try:
        async with SessionLocal() as session:
            rows = (
                await session.execute(
                    select(MarketCacheRow).where(
                        MarketCacheRow.symbol == symbol.upper()
                    )
                )
            ).scalars()
            return {row.function: row.expires_at for row in rows}
    except Exception:
        return {}
