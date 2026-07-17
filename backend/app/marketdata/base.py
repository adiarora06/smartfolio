"""Market snapshot type + provider protocol."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol

import httpx


@dataclass
class MarketSnapshot:
    """Resolved inputs for the forecast engine.

    A live provider typically fills only `price` (+ `as_of`/`source`); the rest
    come from the offline reference base via `merge`.
    """

    symbol: str
    price: Optional[float] = None
    name: Optional[str] = None
    sector: Optional[str] = None
    vol: Optional[float] = None
    trend: Optional[float] = None
    quality: Optional[float] = None
    source: str = "offline"  # "alphavantage" | "finnhub" | "offline"
    as_of: Optional[str] = None


class MarketDataProvider(Protocol):
    name: str

    async def snapshot(self, client: httpx.AsyncClient, symbol: str) -> Optional[MarketSnapshot]:
        """Return a snapshot with at least a price, or None to fall through."""
        ...


def merge(base: MarketSnapshot, live: Optional[MarketSnapshot]) -> MarketSnapshot:
    """Overlay a live snapshot's non-empty fields onto the offline base."""
    if live is None or live.price is None:
        return base
    return MarketSnapshot(
        symbol=base.symbol,
        price=live.price,
        name=live.name or base.name,
        sector=live.sector or base.sector,
        vol=live.vol if live.vol is not None else base.vol,
        trend=live.trend if live.trend is not None else base.trend,
        quality=live.quality if live.quality is not None else base.quality,
        source=live.source,
        as_of=live.as_of,
    )
