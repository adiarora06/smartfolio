"""Deterministic stock forecast engine.

1:1 port of frontend/src/lib/calculations/stock.ts — same inputs always yield
the same forecast; no randomness. Numbers only; the research memo prose is the
AI layer's job.

The price/name/sector/vol/trend/quality inputs arrive as a MarketSnapshot from
the marketdata resolver (live when a key is configured, offline otherwise). The
math below is identical regardless of where the price came from.
"""
from __future__ import annotations

import math
from typing import Optional

from ..marketdata.base import MarketSnapshot
from ..marketdata.offline import offline_snapshot
from ..schemas import BacktestResult, ForecastPoint, StockForecast, StockTrace
from .data import AUDIT_TRACE, TOPOLOGY_TRACE, seed


def analyze_stock(
    ticker: str = "AAPL",
    days: float = 30,
    snapshot: Optional[MarketSnapshot] = None,
) -> StockForecast:
    symbol = ticker.strip().upper() or "AAPL"
    snap = snapshot or offline_snapshot(symbol)
    sd = seed(symbol)

    name = snap.name or f"{symbol} Corp."
    sector = snap.sector or "technology"
    price = float(snap.price if snap.price is not None else 0.0)
    vol = snap.vol if snap.vol is not None else 0.18 + (sd % 28) / 100
    trend = snap.trend if snap.trend is not None else -0.03 + (sd % 18) / 100
    quality = snap.quality if snap.quality is not None else 0.45 + (sd % 45) / 100

    try:
        horizon = float(days)
    except (TypeError, ValueError):
        horizon = 30.0
    if not horizon or horizon != horizon:  # 0 or NaN — matches JS `Number(days) || 30`
        horizon = 30.0
    horizon = max(7.0, min(365.0, horizon))

    scale = horizon / 365
    med = trend * scale + (quality - 0.6) * 0.06 * scale
    unc = vol * math.sqrt(scale)
    bear = med - unc * 0.85
    bull = med + unc * 0.95
    confidence = max(0.0, min(1.0, 0.5 + med * 2.2 + quality * 0.28 - vol * 0.22))
    rating = "Constructive" if confidence > 0.72 else "Neutral" if confidence > 0.5 else "Cautious"

    paths = []
    for i in range(16):
        x = i / 15
        w = math.sin(x * math.pi * 2 + sd / 19) * vol * 0.018
        paths.append(
            ForecastPoint(
                bear=price * (1 + bear * x),
                median=price * (1 + med * x + w),
                bull=price * (1 + bull * x),
            )
        )

    return StockForecast(
        symbol=symbol,
        name=name,
        sector=sector,
        price=price,
        days=horizon,
        vol=vol,
        quality=quality,
        rating=rating,
        confidence=confidence,
        median_target=price * (1 + med),
        bear_target=price * (1 + bear),
        bull_target=price * (1 + bull),
        expected=med,
        paths=paths,
        backtest=BacktestResult(
            windows=18 + sd % 9,
            hit=0.52 + quality * 0.22 - vol * 0.16,
            error=vol * 7.5,
            drawdown=-vol * 0.62,
        ),
        trace=StockTrace(audit=list(AUDIT_TRACE), topology=list(TOPOLOGY_TRACE)),
        source=snap.source,
        as_of=snap.as_of,
    )
