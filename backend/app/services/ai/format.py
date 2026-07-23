"""Formatting helpers matching the frontend's lib/format.ts output."""
from __future__ import annotations

import re


def currency(n: float) -> str:
    """USD with precision that adapts to magnitude, matching lib/format.ts.

    Whole dollars above $100, cents from $1-$100, and up to six decimals below
    $1 — without that last tier every sub-dollar price renders as "$0", which
    reads as missing data rather than a small number.
    """
    magnitude = abs(n)
    if magnitude >= 100:
        return f"${n:,.0f}"
    if magnitude >= 1:
        return f"${n:,.2f}"
    return f"${n:,.6f}".rstrip("0").rstrip(".")


def pct(x: float, d: int = 1) -> str:
    """0..1 fraction as a percentage string, e.g. 0.123 -> "12.3%"."""
    return f"{x * 100:.{d}f}%"


def title_case(s: str) -> str:
    """snake_case key to Title Case, e.g. "us_equity" -> "Us Equity"."""
    return re.sub(r"\b\w", lambda m: m.group().upper(), str(s).replace("_", " "))
