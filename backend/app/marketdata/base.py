"""Market snapshot / context types + the provider protocol."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Protocol

import httpx

from .fundamentals import Fundamentals
from .series import PriceSeries, SeriesStats


@dataclass
class MarketSnapshot:
    """Resolved scalar inputs for the forecast engine.

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


@dataclass
class MarketContext:
    """Everything the engine knows about a symbol, and where each part came from.

    The engine is written against this type rather than against a provider, so
    a ticker with full history plus fundamentals and one with nothing but a
    reference price run through exactly the same code path — the second simply
    carries fewer inputs and, as a result, less conviction.
    """

    snapshot: MarketSnapshot
    series: Optional[PriceSeries] = None
    stats: Optional[SeriesStats] = None
    fundamentals: Optional[Fundamentals] = None
    sentiment: Optional[float] = None  # -1..1, relevance-weighted
    sentiment_articles: int = 0
    # Which inputs are measured rather than assumed — drives both the drift
    # shrinkage and what the UI is allowed to claim.
    sources: List[str] = field(default_factory=list)
    stale_inputs: List[str] = field(default_factory=list)
    # Data-integrity problems worth showing the user rather than swallowing —
    # e.g. a quote that disagrees with the price history it is paired with.
    warnings: List[str] = field(default_factory=list)

    @property
    def has_history(self) -> bool:
        return self.stats is not None

    @property
    def has_fundamentals(self) -> bool:
        return self.fundamentals is not None

    @property
    def data_completeness(self) -> float:
        """0..1 — how much of the model's ideal input set actually arrived."""
        score = 0.0
        if self.snapshot.source != "offline":
            score += 0.25
        if self.has_history:
            score += 0.45
        if self.has_fundamentals:
            score += 0.20
        if self.sentiment is not None:
            score += 0.10
        return round(min(score, 1.0), 4)


class MarketDataProvider(Protocol):
    name: str

    async def snapshot(
        self, client: httpx.AsyncClient, symbol: str
    ) -> Optional[MarketSnapshot]:
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
