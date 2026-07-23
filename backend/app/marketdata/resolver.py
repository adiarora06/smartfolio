"""Resolver — assembles a MarketContext from cache, live providers, and the
offline reference table, in that order of preference.

Design rules:
- Every endpoint is fetched through the cache, so a repeat ticker costs zero
  provider requests. This is what makes a ~25/day free tier usable.
- Every endpoint degrades on its own. A throttled OVERVIEW leaves fundamentals
  empty; the history still produces a real volatility estimate and the engine
  still runs.
- An expired payload beats no payload. When the provider is throttled we fall
  back to the stale cache row and record it in `stale_inputs` so the response
  can say so rather than quietly presenting week-old data as fresh.

Perf notes:
- One shared httpx.AsyncClient (keep-alive pool) instead of a client per
  request — saves a TLS handshake on every live call.
- Per-symbol locks coalesce concurrent fetches so a burst of users costs one
  set of provider calls, not N.
"""
from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Dict, Optional

import httpx

from ..config import settings
from . import cache
from .alphavantage import (
    AlphaVantageProvider,
    parse_fundamentals,
    parse_sentiment,
    parse_series,
)
from .base import MarketContext, MarketDataProvider, MarketSnapshot, merge
from .finnhub import FinnhubProvider, parse_finnhub_fundamentals
from .offline import offline_snapshot
from .series import compute_stats


def _build_provider() -> Optional[MarketDataProvider]:
    """The QUOTE provider — the fast, high-quota live-price source."""
    if not settings.live_market_data_enabled:
        return None
    if settings.market_data_provider == "finnhub":
        return FinnhubProvider(settings.market_data_api_key)
    return AlphaVantageProvider(settings.market_data_api_key)


def _build_deep_provider(
    quote_provider: Optional[MarketDataProvider],
) -> Optional[AlphaVantageProvider]:
    """The DEEP provider (daily history + fundamentals + news) — always Alpha
    Vantage, since it is the only free source of daily candles.

    Reuses the quote provider when that is already Alpha Vantage with the same
    key; otherwise builds a dedicated AV client from the hybrid key. This is
    what lets Finnhub answer quotes while AV answers history/fundamentals.
    """
    if not settings.deep_analysis_enabled:
        return None
    key = settings.deep_api_key
    if not key:
        return None
    if isinstance(quote_provider, AlphaVantageProvider) and quote_provider.api_key == key:
        return quote_provider
    return AlphaVantageProvider(key)


class MarketDataResolver:
    def __init__(self) -> None:
        self.provider = _build_provider()
        self.deep_provider = _build_deep_provider(self.provider)
        self._client: Optional[httpx.AsyncClient] = None
        self._locks: Dict[str, asyncio.Lock] = {}

    @property
    def live_enabled(self) -> bool:
        return self.provider is not None or self.deep_provider is not None

    @property
    def deep_enabled(self) -> bool:
        """Whether a provider can serve history and fundamentals.

        The DEEP_ANALYSIS=0 kill switch is enforced in `_build_deep_provider`
        (it returns None), so the provider simply being present already implies
        deep analysis is enabled — no need to re-consult settings here.
        """
        return self.deep_provider is not None

    @property
    def hybrid(self) -> bool:
        """True when quotes and deep data come from different providers."""
        return (
            self.deep_provider is not None
            and self.provider is not None
            and self.provider is not self.deep_provider
        )

    @property
    def quote_provider_name(self) -> str:
        return self.provider.name if self.provider else "offline"

    @property
    def deep_provider_name(self) -> Optional[str]:
        return self.deep_provider.name if self.deep_provider else None

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

    async def _cached_fetch(
        self,
        symbol: str,
        function: str,
        fetch: Callable[[], Awaitable[Optional[Dict[str, Any]]]],
        ctx: MarketContext,
    ) -> Optional[Dict[str, Any]]:
        """Cache -> live -> stale cache. Records provenance on `ctx`."""
        hit = await cache.get(symbol, function)
        if hit is not None:
            ctx.sources.append(f"{function}:cache")
            return hit
        try:
            payload = await fetch()
        except Exception:
            payload = None
        if payload is not None:
            await cache.put(symbol, function, payload)
            ctx.sources.append(f"{function}:live")
            return payload
        # Provider gave us nothing (throttled, unknown symbol, network error).
        expired = await cache.stale(symbol, function)
        if expired is not None:
            ctx.sources.append(f"{function}:stale")
            ctx.stale_inputs.append(function)
            return expired
        return None

    async def resolve(self, ticker: str) -> MarketContext:
        symbol = ticker.strip().upper() or "AAPL"
        lock = self._locks.setdefault(symbol, asyncio.Lock())
        async with lock:
            return await self._resolve_locked(symbol)

    async def _resolve_locked(self, symbol: str) -> MarketContext:
        base = offline_snapshot(symbol)
        ctx = MarketContext(snapshot=base)

        if self.provider is None and self.deep_provider is None:
            ctx.sources.append("offline:reference")
            return ctx

        client = self._get_client()
        # Quote comes from the primary provider; if there is none (AV-only
        # config), the deep provider doubles as the quote source.
        quote_provider = self.provider or self.deep_provider

        if quote_provider is not None:
            quote_payload = await self._cached_fetch(
                symbol,
                "quote",
                lambda: self._fetch_quote(client, quote_provider, symbol),
                ctx,
            )
            if quote_payload:
                ctx.snapshot = merge(
                    base,
                    MarketSnapshot(
                        symbol=symbol,
                        price=quote_payload.get("price"),
                        as_of=quote_payload.get("asOf"),
                        source=quote_payload.get("source", quote_provider.name),
                    ),
                )

        if not self.deep_enabled or self.deep_provider is None:
            if not ctx.sources:
                ctx.sources.append("offline:reference")
            return ctx

        deep = self.deep_provider

        # History, fundamentals and news are independent — fetch concurrently so
        # a slow OVERVIEW does not serialize behind the (larger) daily payload.
        daily_payload, overview_payload, sentiment_payload = await asyncio.gather(
            self._cached_fetch(
                symbol, "daily", lambda: deep.daily_series(client, symbol), ctx
            ),
            self._cached_fetch(
                symbol, "overview", lambda: deep.overview(client, symbol), ctx
            ),
            self._cached_fetch(
                symbol, "sentiment", lambda: deep.news_sentiment(client, symbol), ctx
            )
            if settings.sentiment_enabled
            else _none(),
        )

        if daily_payload:
            series = parse_series(symbol, daily_payload)
            if series is not None:
                ctx.series = series
                ctx.stats = compute_stats(series)
                # The daily close is the authoritative price when no separate
                # quote arrived — it is the same series the statistics measure,
                # so the spot and the volatility stay mutually consistent.
                if ctx.snapshot.source == "offline" and series.latest:
                    ctx.snapshot.price = series.latest
                    ctx.snapshot.as_of = series.as_of
                    ctx.snapshot.source = deep.name
                else:
                    _reconcile_price(ctx, series.latest, series.as_of)

        if overview_payload:
            fundamentals = parse_fundamentals(symbol, overview_payload)
            self._apply_fundamentals(ctx, fundamentals)
        elif self.provider is not None and hasattr(self.provider, "fundamentals"):
            # Alpha Vantage had no fundamentals (throttled or missing) but the
            # quote provider (Finnhub) exposes its own free metrics — use them
            # so both providers contribute rather than leaving fundamentals bare.
            quote_provider = self.provider
            finnhub_payload = await self._cached_fetch(
                symbol,
                "finnhub_fundamentals",
                lambda: quote_provider.fundamentals(client, symbol),
                ctx,
            )
            if finnhub_payload:
                self._apply_fundamentals(
                    ctx, parse_finnhub_fundamentals(symbol, finnhub_payload)
                )

        if sentiment_payload:
            parsed = parse_sentiment(symbol, sentiment_payload)
            if parsed is not None:
                ctx.sentiment, ctx.sentiment_articles = parsed

        if not ctx.sources:
            ctx.sources.append("offline:reference")
        return ctx

    @staticmethod
    def _apply_fundamentals(ctx: MarketContext, fundamentals) -> None:
        ctx.fundamentals = fundamentals
        if fundamentals.name:
            ctx.snapshot.name = fundamentals.name
        if fundamentals.sector:
            ctx.snapshot.sector = fundamentals.sector

    async def _fetch_quote(
        self, client: httpx.AsyncClient, provider: MarketDataProvider, symbol: str
    ) -> Optional[Dict[str, Any]]:
        """Normalize a provider snapshot into a cacheable dict."""
        snap = await provider.snapshot(client, symbol)
        if snap is None or snap.price is None:
            return None
        return {"price": snap.price, "asOf": snap.as_of, "source": snap.source}


# A quote more than this far from the latest daily close is not an intraday
# move — it is a structural mismatch (an unadjusted split, a bad tick, or a
# symbol collision between endpoints).
PRICE_DIVERGENCE_LIMIT = 0.25


def _reconcile_price(
    ctx: MarketContext, last_close: Optional[float], as_of: Optional[str]
) -> None:
    """Guard against anchoring the cone on a price the statistics disagree with.

    Volatility, momentum and drawdown are all measured from the daily series.
    If the quote endpoint returns something far from that series' last close,
    pairing them produces a forecast whose spread and whose anchor describe
    different instruments. We keep the series close — the value the whole
    statistical model is built on — and surface the divergence rather than
    silently picking one.
    """
    quote = ctx.snapshot.price
    if not quote or not last_close or last_close <= 0:
        return
    divergence = abs(quote / last_close - 1.0)
    if divergence <= PRICE_DIVERGENCE_LIMIT:
        return
    ctx.warnings.append(
        f"quote {quote:,.4g} diverges {divergence:.0%} from the latest daily close "
        f"{last_close:,.4g}; using the close the statistics are measured on"
    )
    ctx.snapshot.price = last_close
    ctx.snapshot.as_of = as_of


async def _none() -> None:
    return None


# Module-level singleton (provider + client pool live for the process lifetime).
resolver = MarketDataResolver()
