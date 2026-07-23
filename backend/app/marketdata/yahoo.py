"""Yahoo Finance daily-history provider — free, keyless, multi-year depth.

Why this exists: Alpha Vantage moved `outputsize=full` for TIME_SERIES_DAILY
behind its premium tier (discovered live — the free tier now serves only the
last ~100 sessions), and Stooq's CSV endpoint now sits behind a JavaScript
anti-bot challenge no server-side client can pass. One hundred closes can
measure volatility but cannot support 12-1 momentum or an honest walk-forward
backtest, both of which need years of history. Yahoo's public chart API serves
three years of daily candles as JSON with no key — it is the same endpoint the
widely-used yfinance library wraps. Unofficial, so the resolver treats it like
any other provider: a failure falls through to the Alpha Vantage compact
fallback and, past that, the stale cache.

Division of labour with this module in place: Yahoo → daily history;
Alpha Vantage → fundamentals + news sentiment (2 requests/ticker of its
~25/day, instead of 3); Finnhub → live quotes + fundamentals fallback.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx

from ..config import settings
from .alphavantage import MAX_OBSERVATIONS
from .series import PriceSeries

CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

# Yahoo rejects clientless default user agents; a plain browser UA is enough.
_HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

# Three years covers 12-1 momentum (253 sessions) plus a couple of years of
# walk-forward origins, and stays within MAX_OBSERVATIONS after trimming.
RANGE = "3y"


async def fetch_daily(client: httpx.AsyncClient, symbol: str) -> Optional[Dict[str, Any]]:
    """Full daily history as a cacheable payload, or None when unavailable.

    The payload is tagged `provider: yahoo` and stored as plain
    [date, close] rows so the parser stays trivial and the shared "daily"
    cache can hold either provider's shape.
    """
    resp = await client.get(
        CHART_URL.format(symbol=quote(symbol.strip().upper(), safe="")),
        params={"range": RANGE, "interval": "1d"},
        headers=_HEADERS,
        timeout=settings.market_data_deep_timeout,
    )
    if resp.status_code != 200:
        return None
    data = resp.json()
    chart = data.get("chart") or {}
    if chart.get("error"):
        return None
    results = chart.get("result")
    if not isinstance(results, list) or not results:
        return None
    result = results[0] or {}
    timestamps = result.get("timestamp")
    quotes = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    closes = quotes.get("close")
    if not isinstance(timestamps, list) or not isinstance(closes, list):
        return None

    rows: List[List[Any]] = []
    for ts, close in zip(timestamps, closes):
        if close is None:  # halted/holiday gaps arrive as nulls
            continue
        try:
            price = float(close)
        except (TypeError, ValueError):
            continue
        if price <= 0:
            continue
        date = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
        rows.append([date, round(price, 4)])
    if len(rows) < 30:
        return None
    rows.sort(key=lambda r: r[0])
    rows = rows[-MAX_OBSERVATIONS:]
    return {"provider": "yahoo", "rows": rows}


def parse_rows_series(symbol: str, payload: Dict[str, Any]) -> Optional[PriceSeries]:
    """Cached rows payload ([date, close] pairs) -> oldest-first PriceSeries."""
    rows = payload.get("rows")
    if not isinstance(rows, list) or len(rows) < 30:
        return None
    try:
        return PriceSeries(
            symbol=symbol,
            dates=[str(r[0]) for r in rows],
            closes=[float(r[1]) for r in rows],
        )
    except (TypeError, ValueError, IndexError):
        return None
