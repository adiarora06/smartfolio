"""Alpha Vantage live quote provider (free tier).

Free key: https://www.alphavantage.co/support/#api-key (takes ~20 seconds).
The public "demo" key only serves IBM — enough to prove the pipeline; any other
ticker returns an info message, which we treat as "no data" (falls back offline).
"""
from __future__ import annotations

from typing import Optional

import httpx

from .base import MarketSnapshot

QUOTE_URL = "https://www.alphavantage.co/query"


class AlphaVantageProvider:
    name = "alphavantage"

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    async def snapshot(self, client: httpx.AsyncClient, symbol: str) -> Optional[MarketSnapshot]:
        resp = await client.get(
            QUOTE_URL,
            params={"function": "GLOBAL_QUOTE", "symbol": symbol, "apikey": self.api_key},
        )
        resp.raise_for_status()
        data = resp.json()
        quote = data.get("Global Quote") or {}
        price = quote.get("05. price")
        if not price:
            # Rate-limit note, demo-key info, or unknown symbol -> fall through.
            return None
        try:
            price_f = float(price)
        except (TypeError, ValueError):
            return None
        if price_f <= 0:
            return None
        return MarketSnapshot(
            symbol=symbol,
            price=price_f,
            as_of=quote.get("07. latest trading day"),
            source=self.name,
        )
