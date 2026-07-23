"""Company fundamentals + the quality score derived from them.

`quality` used to be `0.45 + (hash(ticker) % 45) / 100` — a number with no
relationship to the company. When an OVERVIEW payload is available it is now a
blend of real profitability, balance-sheet, growth and valuation measures.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass(frozen=True)
class Fundamentals:
    """Company facts. Every field optional — providers omit plenty."""

    symbol: str
    name: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    market_cap: Optional[float] = None
    beta: Optional[float] = None
    pe_ratio: Optional[float] = None
    forward_pe: Optional[float] = None
    peg_ratio: Optional[float] = None
    price_to_book: Optional[float] = None
    profit_margin: Optional[float] = None
    operating_margin: Optional[float] = None
    return_on_equity: Optional[float] = None
    revenue_growth_yoy: Optional[float] = None
    earnings_growth_yoy: Optional[float] = None
    dividend_yield: Optional[float] = None
    eps: Optional[float] = None
    analyst_target: Optional[float] = None
    week52_high: Optional[float] = None
    week52_low: Optional[float] = None

    @property
    def earnings_yield(self) -> Optional[float]:
        """Inverse P/E — the return the price implies at current earnings."""
        if self.pe_ratio and self.pe_ratio > 0:
            return 1.0 / self.pe_ratio
        return None


def _score(value: Optional[float], midpoint: float, scale: float) -> Optional[float]:
    """Map a raw measure to 0..1 with a logistic centred on `midpoint`.

    A logistic rather than a hard clamp so that extreme values saturate
    smoothly instead of creating cliffs where a rounding difference flips a
    company between buckets.
    """
    if value is None:
        return None
    try:
        return 1.0 / (1.0 + math.exp(-(value - midpoint) / scale))
    except OverflowError:
        return 0.0 if value < midpoint else 1.0


# (label, midpoint, scale, weight) — the midpoint is roughly the S&P median for
# that measure, so 0.5 means "typical large-cap US company".
_QUALITY_FACTORS: Tuple[Tuple[str, float, float, float], ...] = (
    ("profit_margin", 0.10, 0.06, 1.0),
    ("operating_margin", 0.14, 0.08, 0.8),
    ("return_on_equity", 0.15, 0.10, 1.0),
    ("revenue_growth_yoy", 0.06, 0.08, 0.9),
    ("earnings_growth_yoy", 0.08, 0.12, 0.7),
)


@dataclass(frozen=True)
class QualityScore:
    """A 0..1 quality score plus the per-factor breakdown behind it."""

    value: float
    factors: Dict[str, float]
    measured: bool  # False when this fell back to the reference table


def quality_score(f: Optional[Fundamentals], fallback: float) -> QualityScore:
    """Blend the available fundamental factors into 0..1.

    Falls back to the offline reference value when no fundamentals arrived, and
    reports `measured=False` so the caller can shrink its drift conviction and
    the UI can say so honestly.
    """
    if f is None:
        return QualityScore(value=fallback, factors={}, measured=False)

    factors: Dict[str, float] = {}
    weighted: List[Tuple[float, float]] = []
    for field, midpoint, scale, weight in _QUALITY_FACTORS:
        scored = _score(getattr(f, field), midpoint, scale)
        if scored is not None:
            factors[field] = scored
            weighted.append((scored, weight))

    # Valuation enters inverted: a rich multiple is a lower-quality entry point
    # at the same fundamentals, not a better company.
    if f.peg_ratio is not None and f.peg_ratio > 0:
        valuation = 1.0 - (_score(f.peg_ratio, 1.6, 0.8) or 0.5)
        factors["peg_ratio"] = valuation
        weighted.append((valuation, 0.6))
    elif f.pe_ratio is not None and f.pe_ratio > 0:
        valuation = 1.0 - (_score(f.pe_ratio, 22.0, 10.0) or 0.5)
        factors["pe_ratio"] = valuation
        weighted.append((valuation, 0.5))

    if not weighted:
        return QualityScore(value=fallback, factors={}, measured=False)

    total = sum(w for _, w in weighted)
    value = sum(v * w for v, w in weighted) / total
    return QualityScore(value=min(max(value, 0.0), 1.0), factors=factors, measured=True)
