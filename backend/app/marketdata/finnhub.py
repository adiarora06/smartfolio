"""Finnhub provider — the fast, high-quota quote source (free tier: 60 req/min).

Free key: https://finnhub.io/register

Finnhub's role in the hybrid setup is the live quote (`/quote`), which it serves
far more generously than Alpha Vantage's ~25/day. It cannot provide historical
daily candles on the free tier (that moved to premium), so the forecast's
volatility and backtest come from Alpha Vantage. Finnhub CAN provide company
fundamentals for free (`/stock/metric` + `/stock/profile2`), so it acts as the
fundamentals fallback when Alpha Vantage's OVERVIEW budget is exhausted — that
is what lets both providers contribute real data.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

from .base import MarketSnapshot
from .fundamentals import Fundamentals

BASE_URL = "https://finnhub.io/api/v1"
QUOTE_URL = f"{BASE_URL}/quote"
METRIC_URL = f"{BASE_URL}/stock/metric"
PROFILE_URL = f"{BASE_URL}/stock/profile2"

# Finnhub's coarse industry buckets -> SmartFolio sector vocabulary.
_INDUSTRY_MAP: Dict[str, str] = {
    "technology": "technology",
    "communications": "communication_services",
    "media": "communication_services",
    "consumer discretionary": "consumer_cyclical",
    "retail": "consumer_cyclical",
    "consumer staples": "consumer_defensive",
    "financial services": "financial_services",
    "banking": "financial_services",
    "insurance": "financial_services",
    "health care": "healthcare",
    "pharmaceuticals": "healthcare",
    "industrials": "industrial",
    "energy": "energy",
    "utilities": "utilities",
    "real estate": "real_estate",
    "basic materials": "basic_materials",
}


def _map_industry(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    key = raw.strip().lower()
    if key in _INDUSTRY_MAP:
        return _INDUSTRY_MAP[key]
    return key.replace(" ", "_").replace("&", "and").replace("-", "_")


def _num(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value != value:  # NaN
        return None
    return value


def _pct(raw: Any) -> Optional[float]:
    """Finnhub reports margins/growth/yield as percentages (25.3), not decimals."""
    value = _num(raw)
    return value / 100.0 if value is not None else None


class FinnhubProvider:
    name = "finnhub"

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    async def _get(
        self, client: httpx.AsyncClient, url: str, params: Dict[str, str]
    ) -> Optional[Dict[str, Any]]:
        resp = await client.get(url, params={**params, "token": self.api_key})
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, dict) else None

    async def snapshot(
        self, client: httpx.AsyncClient, symbol: str
    ) -> Optional[MarketSnapshot]:
        data = await self._get(client, QUOTE_URL, {"symbol": symbol})
        if not data:
            return None
        price = data.get("c")
        if not price:  # 0 or missing -> unknown symbol / no data
            return None
        as_of = None
        ts = data.get("t")
        if ts:
            as_of = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
        return MarketSnapshot(symbol=symbol, price=float(price), as_of=as_of, source=self.name)

    async def fundamentals(
        self, client: httpx.AsyncClient, symbol: str
    ) -> Optional[Dict[str, Any]]:
        """Raw metric + profile payloads, returned as one cacheable dict.

        Both are free-tier endpoints. Returns None only when neither responds,
        so a company with a profile but no metrics (or vice versa) still yields
        something usable.
        """
        metric = await self._get(
            client, METRIC_URL, {"symbol": symbol, "metric": "all"}
        )
        profile = await self._get(client, PROFILE_URL, {"symbol": symbol})
        if not metric and not profile:
            return None
        return {"metric": (metric or {}).get("metric") or {}, "profile": profile or {}}


def parse_finnhub_fundamentals(symbol: str, payload: Dict[str, Any]) -> Fundamentals:
    """Finnhub metric + profile payload -> typed fundamentals.

    Finnhub reports margins, growth and dividend yield in PERCENT (unlike Alpha
    Vantage's decimals), and market cap in MILLIONS, so both are normalized here
    to the same units the rest of the engine uses.
    """
    metric = payload.get("metric") or {}
    profile = payload.get("profile") or {}

    market_cap = _num(profile.get("marketCapitalization"))
    if market_cap is not None:
        market_cap *= 1_000_000  # Finnhub reports this in millions

    return Fundamentals(
        symbol=symbol,
        name=profile.get("name") or None,
        sector=_map_industry(profile.get("finnhubIndustry")),
        industry=profile.get("finnhubIndustry") or None,
        market_cap=market_cap,
        beta=_num(metric.get("beta")),
        pe_ratio=_num(metric.get("peTTM") or metric.get("peBasicExclExtraTTM")),
        price_to_book=_num(metric.get("pbQuarterly") or metric.get("pbAnnual")),
        profit_margin=_pct(metric.get("netProfitMarginTTM")),
        operating_margin=_pct(metric.get("operatingMarginTTM")),
        return_on_equity=_pct(metric.get("roeTTM")),
        revenue_growth_yoy=_pct(metric.get("revenueGrowthTTMYoy")),
        earnings_growth_yoy=_pct(metric.get("epsGrowthTTMYoy")),
        dividend_yield=_pct(metric.get("currentDividendYieldTTM")),
        eps=_num(metric.get("epsTTM")),
        week52_high=_num(metric.get("52WeekHigh")),
        week52_low=_num(metric.get("52WeekLow")),
    )
