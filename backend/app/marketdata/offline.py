"""Offline reference provider — the always-available backstop.

Reproduces the prototype's deterministic base table (and the synthetic values
for unknown tickers), so with no live provider the engine behaves exactly as it
did before.
"""
from __future__ import annotations

from ..services.data import FALLBACK_SECTORS, STOCK_BASE, seed
from .base import MarketSnapshot


def offline_snapshot(symbol: str) -> MarketSnapshot:
    symbol = symbol.strip().upper() or "AAPL"
    base = STOCK_BASE.get(symbol)
    if base:
        name, sector, price, vol, trend, quality = base
    else:
        sd = seed(symbol)
        name = f"{symbol} Corp."
        sector = FALLBACK_SECTORS[sd % 4]
        price = 40 + sd % 260
        vol = 0.18 + (sd % 28) / 100
        trend = -0.03 + (sd % 18) / 100
        quality = 0.45 + (sd % 45) / 100
    return MarketSnapshot(
        symbol=symbol,
        price=float(price),
        name=name,
        sector=sector,
        vol=vol,
        trend=trend,
        quality=quality,
        source="offline",
    )
