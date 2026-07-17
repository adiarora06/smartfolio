"""Finnhub live quote provider (free tier — 60 req/min).

Free key: https://finnhub.io/register
`/quote` returns c (current price) and t (unix timestamp).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import httpx

from .base import MarketSnapshot

QUOTE_URL = "https://finnhub.io/api/v1/quote"


class FinnhubProvider:
    name = "finnhub"

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    async def snapshot(self, client: httpx.AsyncClient, symbol: str) -> Optional[MarketSnapshot]:
        resp = await client.get(QUOTE_URL, params={"symbol": symbol, "token": self.api_key})
        resp.raise_for_status()
        data = resp.json()
        price = data.get("c")
        if not price:  # 0 or missing -> unknown symbol / no data
            return None
        as_of = None
        ts = data.get("t")
        if ts:
            as_of = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
        return MarketSnapshot(symbol=symbol, price=float(price), as_of=as_of, source=self.name)
