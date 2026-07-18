"""Formatting helpers matching the frontend's lib/format.ts output."""
from __future__ import annotations

import re


def currency(n: float) -> str:
    """USD with no decimals, e.g. 1234.6 -> "$1,235"."""
    return f"${n:,.0f}"


def pct(x: float, d: int = 1) -> str:
    """0..1 fraction as a percentage string, e.g. 0.123 -> "12.3%"."""
    return f"{x * 100:.{d}f}%"


def title_case(s: str) -> str:
    """snake_case key to Title Case, e.g. "us_equity" -> "Us Equity"."""
    return re.sub(r"\b\w", lambda m: m.group().upper(), str(s).replace("_", " "))
