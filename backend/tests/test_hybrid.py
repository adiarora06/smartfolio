"""Hybrid market-data routing: Finnhub quotes + Alpha Vantage deep data.

The point of the hybrid is that the two providers have complementary free
tiers — Finnhub gives fast quotes but no history, Alpha Vantage gives history
and fundamentals but only ~25 requests/day. These tests verify the resolver
routes each request to the right provider and that Finnhub's free fundamentals
fill in when Alpha Vantage's OVERVIEW budget is spent.
"""
from __future__ import annotations

import asyncio
import datetime

import pytest

from app.marketdata import resolver as resolver_mod
from app.marketdata.base import MarketSnapshot
from app.marketdata.resolver import MarketDataResolver


def _av_daily_payload(n=90, start=300.0, step=0.5):
    """Minimal TIME_SERIES_DAILY payload with an ascending close series."""
    series = {}
    day = datetime.date(2026, 1, 1)
    price = start
    for _ in range(n):
        series[day.isoformat()] = {"4. close": f"{price:.2f}"}
        price += step
        day += datetime.timedelta(days=1)
    return {"Time Series (Daily)": series}


class FakeFinnhub:
    name = "finnhub"

    def __init__(self, api_key="fk"):
        self.api_key = api_key
        self.quote_calls = 0
        self.fundamentals_calls = 0

    async def snapshot(self, client, symbol):
        self.quote_calls += 1
        return MarketSnapshot(symbol, price=344.0, as_of="2026-07-22", source="finnhub")

    async def fundamentals(self, client, symbol):
        self.fundamentals_calls += 1
        return {
            "metric": {"beta": 1.15, "peTTM": 25.0, "netProfitMarginTTM": 20.0, "roeTTM": 28.0},
            "profile": {"name": "Fallback Co", "finnhubIndustry": "Technology"},
        }


class FakeAV:
    name = "alphavantage"

    def __init__(self, api_key="av", overview=True):
        self.api_key = api_key
        self._overview = overview
        self.daily_calls = 0
        self.overview_calls = 0

    async def snapshot(self, client, symbol):
        return MarketSnapshot(symbol, price=343.0, as_of="2026-07-22", source="alphavantage")

    async def daily_series(self, client, symbol):
        self.daily_calls += 1
        return _av_daily_payload()

    async def overview(self, client, symbol):
        self.overview_calls += 1
        if not self._overview:
            return None  # simulate the daily budget being exhausted
        return {
            "Symbol": symbol,
            "Name": "Alpha Co",
            "Sector": "TECHNOLOGY",
            "Beta": "1.10",
            "PERatio": "27.0",
            "ProfitMargin": "0.22",
            "ReturnOnEquityTTM": "0.30",
            "AnalystTargetPrice": "380",
        }

    async def news_sentiment(self, client, symbol):
        return None


def _hybrid_resolver(finnhub, av):
    r = MarketDataResolver()
    r.provider = finnhub
    r.deep_provider = av
    return r


def test_quote_from_finnhub_history_from_alphavantage():
    """The defining behaviour: spot price comes from Finnhub, the daily series
    (and therefore volatility + backtest inputs) comes from Alpha Vantage."""
    finnhub, av = FakeFinnhub(), FakeAV(overview=True)
    ctx = asyncio.run(_hybrid_resolver(finnhub, av).resolve("HYB1"))

    assert finnhub.quote_calls == 1
    assert av.daily_calls == 1
    # Price is Finnhub's live quote...
    assert ctx.snapshot.price == 344.0
    # ...but the measured statistics exist because AV supplied the history.
    assert ctx.stats is not None
    assert ctx.series is not None
    # AV overview was available, so Finnhub's fundamentals fallback stayed idle.
    assert finnhub.fundamentals_calls == 0
    assert ctx.fundamentals is not None and ctx.fundamentals.name == "Alpha Co"
    assert "quote:live" in ctx.sources or "quote:cache" in ctx.sources


def test_finnhub_fundamentals_fill_in_when_alphavantage_overview_missing():
    """When AV's OVERVIEW budget is spent, Finnhub's free metrics supply the
    fundamentals so the analysis is not left bare — both providers contribute."""
    finnhub, av = FakeFinnhub(), FakeAV(overview=False)
    ctx = asyncio.run(_hybrid_resolver(finnhub, av).resolve("HYB2"))

    assert av.overview_calls == 1  # AV was asked first...
    assert finnhub.fundamentals_calls == 1  # ...and Finnhub filled the gap.
    assert ctx.fundamentals is not None
    assert ctx.fundamentals.name == "Fallback Co"
    # Finnhub reports margins in percent; the parser must have normalized them.
    assert ctx.fundamentals.profit_margin == pytest.approx(0.20)
    assert ctx.fundamentals.return_on_equity == pytest.approx(0.28)


def test_history_still_runs_when_only_alphavantage_key_is_present():
    """AV-only config (no separate quote provider) still produces a full context
    by using the deep provider for the quote too."""
    av = FakeAV(overview=True)
    r = MarketDataResolver()
    r.provider = None
    r.deep_provider = av
    ctx = asyncio.run(r.resolve("HYB3"))

    assert ctx.snapshot.price == 343.0  # AV quote
    assert ctx.stats is not None  # AV history
    assert ctx.fundamentals is not None


def _yahoo_rows_payload(n=400, start=200.0, step=0.3):
    day = datetime.date(2025, 1, 1)
    rows, price = [], start
    for _ in range(n):
        rows.append([day.isoformat(), round(price, 4)])
        price += step
        day += datetime.timedelta(days=1)
    return {"provider": "yahoo", "rows": rows}


def test_yahoo_history_preferred_over_alphavantage(monkeypatch):
    """Daily history should come from Yahoo (free, keyless, 3y depth) without
    spending any of Alpha Vantage's ~25/day budget; AV compact is the fallback."""
    finnhub, av = FakeFinnhub(), FakeAV(overview=True)

    async def fake_yahoo(client, symbol):
        return _yahoo_rows_payload()

    monkeypatch.setattr(resolver_mod, "yahoo_fetch_daily", fake_yahoo)
    ctx = asyncio.run(_hybrid_resolver(finnhub, av).resolve("HYB4"))

    assert av.daily_calls == 0  # Yahoo answered; AV budget untouched
    assert ctx.stats is not None
    assert ctx.stats.observations == 400
    # 400 ascending sessions -> momentum is computable, which 100 AV rows can't do.
    assert ctx.stats.momentum_12_1 is not None


def test_alphavantage_compact_is_the_history_fallback(monkeypatch):
    """When Yahoo fails (unofficial API — it will, sometimes), history falls
    through to Alpha Vantage rather than disappearing."""
    finnhub, av = FakeFinnhub(), FakeAV(overview=True)

    async def broken_yahoo(client, symbol):
        raise RuntimeError("yahoo changed something again")

    monkeypatch.setattr(resolver_mod, "yahoo_fetch_daily", broken_yahoo)
    ctx = asyncio.run(_hybrid_resolver(finnhub, av).resolve("HYB5"))

    assert av.daily_calls == 1
    assert ctx.stats is not None  # AV's 90-row payload still measured vol


def test_parse_rows_series_roundtrip():
    from app.marketdata.yahoo import parse_rows_series

    payload = _yahoo_rows_payload(n=60)
    series = parse_rows_series("X", payload)
    assert series is not None and len(series) == 60
    assert series.closes[0] < series.closes[-1]
    # Garbage shapes must parse to None, not raise.
    assert parse_rows_series("X", {"provider": "yahoo"}) is None
    assert parse_rows_series("X", {"provider": "yahoo", "rows": [[1]] * 40}) is None


def test_live_deep_calls_are_spaced_not_burst():
    """Regression: Alpha Vantage's free tier throttles bursts (~1 req/sec).
    Firing daily+overview+sentiment concurrently got all three throttled in
    production, silently degrading the deep path to reference values. Live
    deep calls must be serialized with a minimum spacing."""
    import time as _time

    r = MarketDataResolver()
    r.DEEP_CALL_SPACING = 0.15  # keep the test fast; the invariant is spacing>0
    call_times: list[float] = []

    async def fake_fetch():
        call_times.append(_time.monotonic())
        return {"ok": True}

    async def run():
        await asyncio.gather(
            r._spaced_deep_call(fake_fetch),
            r._spaced_deep_call(fake_fetch),
            r._spaced_deep_call(fake_fetch),
        )

    asyncio.run(run())
    assert len(call_times) == 3
    gaps = [b - a for a, b in zip(call_times, call_times[1:])]
    assert all(gap >= 0.14 for gap in gaps), f"live calls burst together: gaps={gaps}"


def test_health_reports_hybrid_shape(monkeypatch):
    """/health must advertise both providers so the UI can show the split."""
    finnhub, av = FakeFinnhub(), FakeAV()
    r = _hybrid_resolver(finnhub, av)
    assert r.quote_provider_name == "finnhub"
    assert r.deep_provider_name == "alphavantage"
    assert r.hybrid is True
