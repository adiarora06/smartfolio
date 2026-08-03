"""Alpha Vantage provider — quote, daily history, fundamentals, news sentiment.

Free key: https://www.alphavantage.co/support/#api-key (takes ~20 seconds).

Budget matters here. The free tier allows roughly 25 requests per day, and a
deep analysis costs three of them per ticker, so every payload this module
fetches is cached by the caller (see cache.py) and reused across restarts.
Each endpoint degrades independently: a throttled OVERVIEW does not stop the
history from producing a real volatility estimate.

The public "demo" key only serves IBM. Any other ticker comes back as an
informational message, which we treat as "no data" and fall through.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import httpx

from ..config import settings
from .base import MarketSnapshot, NewsArticle
from .fundamentals import Fundamentals
from .series import PriceSeries

API_URL = "https://www.alphavantage.co/query"

# Keep three years of closes: enough for 12-1 momentum plus a walk-forward
# backtest, without holding 20 years of history in memory per symbol.
MAX_OBSERVATIONS = 780

# Alpha Vantage reports its own coarse sector buckets; map them onto the
# SmartFolio sector vocabulary used by the portfolio engine.
_SECTOR_MAP: Dict[str, str] = {
    "TECHNOLOGY": "technology",
    "LIFE SCIENCES": "healthcare",
    "HEALTH CARE": "healthcare",
    "FINANCE": "financial_services",
    "MANUFACTURING": "industrial",
    "TRADE & SERVICES": "consumer_cyclical",
    "ENERGY & TRANSPORTATION": "energy",
    "REAL ESTATE & CONSTRUCTION": "real_estate",
    "UTILITIES": "utilities",
    "CONSUMER STAPLES": "consumer_defensive",
    "CONSUMER DISCRETIONARY": "consumer_cyclical",
    "COMMUNICATION SERVICES": "communication_services",
    "BASIC MATERIALS": "basic_materials",
}


def map_sector(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    key = raw.strip().upper()
    if key in _SECTOR_MAP:
        return _SECTOR_MAP[key]
    return key.lower().replace(" ", "_").replace("&", "and")


def _num(raw: Any) -> Optional[float]:
    """Alpha Vantage returns everything as a string, with 'None'/'-' for missing."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text or text in {"None", "-", "0.00%", "NaN"}:
        return None
    text = text.rstrip("%")
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def is_throttled(payload: Dict[str, Any]) -> bool:
    """True when the response is a rate-limit or demo-key notice, not data."""
    return any(k in payload for k in ("Note", "Information", "Error Message"))


class AlphaVantageProvider:
    name = "alphavantage"

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    async def _get(
        self,
        client: httpx.AsyncClient,
        params: Dict[str, str],
        timeout: Optional[float] = None,
    ) -> Optional[Dict[str, Any]]:
        resp = await client.get(
            API_URL,
            params={**params, "apikey": self.api_key},
            timeout=timeout if timeout is not None else httpx.USE_CLIENT_DEFAULT,
        )
        resp.raise_for_status()
        payload = resp.json()
        if not isinstance(payload, dict) or is_throttled(payload):
            return None
        return payload

    # --- Quote ------------------------------------------------------------

    async def snapshot(
        self, client: httpx.AsyncClient, symbol: str
    ) -> Optional[MarketSnapshot]:
        payload = await self._get(
            client, {"function": "GLOBAL_QUOTE", "symbol": symbol}
        )
        if not payload:
            return None
        quote = payload.get("Global Quote") or {}
        price = _num(quote.get("05. price"))
        if not price or price <= 0:
            return None
        return MarketSnapshot(
            symbol=symbol,
            price=price,
            as_of=quote.get("07. latest trading day"),
            source=self.name,
        )

    # --- Daily history ----------------------------------------------------

    async def daily_series(
        self, client: httpx.AsyncClient, symbol: str
    ) -> Optional[Dict[str, Any]]:
        """Raw daily payload. Cached by the caller; parsed by `parse_series`.

        `outputsize=compact` (~100 sessions) on purpose: `full` is a PREMIUM
        feature on today's free tier — requesting it returns a politely-worded
        rejection, not data (verified live). A hundred closes still measures
        volatility honestly; the depth needed for momentum and the walk-forward
        backtest comes from Yahoo (yahoo.py), with this as the fallback.
        """
        return await self._get(
            client,
            {
                "function": "TIME_SERIES_DAILY",
                "symbol": symbol,
                "outputsize": "compact",
            },
            timeout=settings.market_data_deep_timeout,
        )

    # --- Fundamentals -----------------------------------------------------

    async def overview(
        self, client: httpx.AsyncClient, symbol: str
    ) -> Optional[Dict[str, Any]]:
        payload = await self._get(client, {"function": "OVERVIEW", "symbol": symbol})
        # A valid-but-empty OVERVIEW ({}), which AV returns for ETFs and
        # unknown tickers, is not an error but carries nothing usable.
        if not payload or not payload.get("Symbol"):
            return None
        return payload

    # --- News sentiment ---------------------------------------------------

    async def news_sentiment(
        self, client: httpx.AsyncClient, symbol: str
    ) -> Optional[Dict[str, Any]]:
        payload = await self._get(
            client,
            {"function": "NEWS_SENTIMENT", "tickers": symbol, "limit": "50"},
        )
        # An empty feed is a well-formed response carrying nothing. Caching it
        # (and recording the fetch as a live source) would misreport an unknown
        # ticker as one we successfully gathered news for.
        if not payload:
            return None
        feed = payload.get("feed")
        if not isinstance(feed, list) or not feed:
            return None
        return payload


# --- Parsers (pure — operate on cached payloads, no network) ---------------


def parse_series(symbol: str, payload: Dict[str, Any]) -> Optional[PriceSeries]:
    """Daily payload -> oldest-first PriceSeries, trimmed to MAX_OBSERVATIONS."""
    block = payload.get("Time Series (Daily)")
    if not isinstance(block, dict) or not block:
        return None
    rows: List[Tuple[str, float]] = []
    for date, values in block.items():
        close = _num(values.get("4. close")) if isinstance(values, dict) else None
        if close and close > 0:
            rows.append((date, close))
    if len(rows) < 30:
        return None
    rows.sort(key=lambda r: r[0])  # AV returns newest-first
    rows = rows[-MAX_OBSERVATIONS:]
    return PriceSeries(
        symbol=symbol,
        dates=[r[0] for r in rows],
        closes=[r[1] for r in rows],
    )


def parse_fundamentals(symbol: str, payload: Dict[str, Any]) -> Fundamentals:
    """OVERVIEW payload -> typed fundamentals.

    Alpha Vantage reports margins and growth as decimals already (0.24 = 24%)
    but dividend yield sometimes arrives as a percentage string, so it goes
    through the same `_num` normalisation and is treated as a decimal.
    """
    return Fundamentals(
        symbol=symbol,
        name=payload.get("Name") or None,
        sector=map_sector(payload.get("Sector")),
        industry=payload.get("Industry") or None,
        market_cap=_num(payload.get("MarketCapitalization")),
        beta=_num(payload.get("Beta")),
        pe_ratio=_num(payload.get("PERatio")),
        forward_pe=_num(payload.get("ForwardPE")),
        peg_ratio=_num(payload.get("PEGRatio")),
        price_to_book=_num(payload.get("PriceToBookRatio")),
        profit_margin=_num(payload.get("ProfitMargin")),
        operating_margin=_num(payload.get("OperatingMarginTTM")),
        return_on_equity=_num(payload.get("ReturnOnEquityTTM")),
        revenue_growth_yoy=_num(payload.get("QuarterlyRevenueGrowthYOY")),
        earnings_growth_yoy=_num(payload.get("QuarterlyEarningsGrowthYOY")),
        dividend_yield=_num(payload.get("DividendYield")),
        eps=_num(payload.get("EPS")),
        analyst_target=_num(payload.get("AnalystTargetPrice")),
        week52_high=_num(payload.get("52WeekHigh")),
        week52_low=_num(payload.get("52WeekLow")),
    )


def parse_sentiment(symbol: str, payload: Dict[str, Any]) -> Optional[Tuple[float, int]]:
    """NEWS_SENTIMENT payload -> (relevance-weighted score in -1..1, article count).

    Weighting by relevance stops a passing mention in an unrelated market
    round-up from counting as much as a story actually about the company.
    """
    feed = payload.get("feed")
    if not isinstance(feed, list) or not feed:
        return None
    target = symbol.upper()
    weighted = 0.0
    weight_total = 0.0
    counted = 0
    for article in feed:
        if not isinstance(article, dict):
            continue
        for entry in article.get("ticker_sentiment") or []:
            if not isinstance(entry, dict):
                continue
            if (entry.get("ticker") or "").upper() != target:
                continue
            score = _num(entry.get("ticker_sentiment_score"))
            relevance = _num(entry.get("relevance_score")) or 0.0
            if score is None or relevance <= 0:
                continue
            weighted += score * relevance
            weight_total += relevance
            counted += 1
    if weight_total <= 0 or counted == 0:
        return None
    return max(-1.0, min(1.0, weighted / weight_total)), counted


def _published_date(raw: Any) -> Optional[str]:
    """AV stamps articles as "20260723T134500" -> "2026-07-23"."""
    if not isinstance(raw, str) or len(raw) < 8 or not raw[:8].isdigit():
        return None
    return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"


def _clip(text: Any, limit: int = 220) -> Optional[str]:
    if not isinstance(text, str):
        return None
    cleaned = " ".join(text.split())
    if not cleaned:
        return None
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "…"


def parse_articles(
    symbol: str, payload: Dict[str, Any], limit: int = 3
) -> List[NewsArticle]:
    """NEWS_SENTIMENT payload -> the `limit` most relevant recent headlines.

    Ranked by this ticker's own relevance score (the same weight the aggregate
    sentiment uses), so a passing mention loses to a story actually about the
    company. Sentiment label/score are taken from the ticker-specific entry
    when present, falling back to the article's overall tone.
    """
    feed = payload.get("feed")
    if not isinstance(feed, list) or not feed:
        return []
    target = symbol.upper()
    ranked: List[Tuple[float, NewsArticle]] = []
    for article in feed:
        if not isinstance(article, dict):
            continue
        title = article.get("title")
        if not isinstance(title, str) or not title.strip():
            continue
        relevance = 0.0
        label = article.get("overall_sentiment_label")
        score = _num(article.get("overall_sentiment_score"))
        tagged = False
        for entry in article.get("ticker_sentiment") or []:
            if not isinstance(entry, dict):
                continue
            if (entry.get("ticker") or "").upper() != target:
                continue
            tagged = True
            relevance = _num(entry.get("relevance_score")) or 0.0
            label = entry.get("ticker_sentiment_label") or label
            score = _num(entry.get("ticker_sentiment_score"))
            break
        # Only stories actually tagged with this ticker — a feed item that never
        # mentions the company is not news "about" it.
        if not tagged:
            continue
        ranked.append(
            (
                relevance,
                NewsArticle(
                    title=title.strip(),
                    source=article.get("source") or None,
                    url=article.get("url") or None,
                    published=_published_date(article.get("time_published")),
                    summary=_clip(article.get("summary")),
                    sentiment_label=label if isinstance(label, str) else None,
                    sentiment_score=score,
                ),
            )
        )
    # Highest relevance first; the feed already arrives newest-first, and Python
    # sort is stable, so equal-relevance items keep that recency order.
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return [article for _, article in ranked[: max(0, limit)]]
