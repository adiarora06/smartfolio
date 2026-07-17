"""Static deterministic inputs.

Mirrors frontend/src/lib/data/constants.ts — target allocations, assumed
returns, and the offline stock reference table.
"""
from __future__ import annotations

from typing import Dict, Tuple


def seed(ticker: str) -> int:
    """Stable per-ticker seed so unknown tickers get deterministic pseudo-data."""
    return sum(ord(c) * (i + 3) for i, c in enumerate(ticker))

# Target allocation by risk profile.
TARGETS: Dict[str, Dict[str, float]] = {
    "conservative": {"us_equity": 0.3, "intl_equity": 0.1, "bonds": 0.45, "cash": 0.1, "alternatives": 0.05},
    "balanced": {"us_equity": 0.45, "intl_equity": 0.2, "bonds": 0.25, "cash": 0.25, "alternatives": 0.05},
    "growth": {"us_equity": 0.6, "intl_equity": 0.25, "bonds": 0.1, "cash": 0.03, "alternatives": 0.02},
    "aggressive": {"us_equity": 0.7, "intl_equity": 0.22, "bonds": 0.03, "cash": 0.02, "alternatives": 0.03},
}

# Assumed annual return by asset class (decimal).
RETURNS: Dict[str, float] = {
    "us_equity": 0.18,
    "intl_equity": 0.12,
    "bonds": 0.05,
    "cash": 0.045,
    "alternatives": 0.08,
    "crypto": 0.22,
    "other": 0.0,
}

# Offline reference quotes: (name, sector, price, vol, trend, quality).
StockBase = Tuple[str, str, float, float, float, float]

STOCK_BASE: Dict[str, StockBase] = {
    "AAPL": ("Apple Inc.", "technology", 215, 0.24, 0.07, 0.82),
    "MSFT": ("Microsoft Corp.", "technology", 448, 0.22, 0.08, 0.88),
    "NVDA": ("NVIDIA Corp.", "technology", 132, 0.42, 0.14, 0.78),
    "TSLA": ("Tesla Inc.", "consumer_cyclical", 248, 0.48, 0.05, 0.58),
    "AMZN": ("Amazon.com Inc.", "consumer_cyclical", 193, 0.31, 0.09, 0.74),
    "GOOGL": ("Alphabet Inc.", "communication_services", 181, 0.28, 0.08, 0.8),
    "JPM": ("JPMorgan Chase & Co.", "financial_services", 214, 0.25, 0.04, 0.76),
    "VOO": ("Vanguard S&P 500 ETF", "broad_market", 510, 0.17, 0.06, 0.9),
}

FALLBACK_SECTORS = ("technology", "healthcare", "financial_services", "industrial")

AUDIT_TRACE = (
    "Ticker normalized",
    "Market data resolved",
    "Forecast generated",
    "Backtest sampled",
    "Memo written",
)

TOPOLOGY_TRACE = (
    "Ticker Intake Agent normalizes symbol and horizon.",
    "Market Data Tool provides price, volatility, sector, and quality inputs.",
    "Forecast Agent creates median, bear, and bull paths.",
    "Backtest Agent evaluates sample windows.",
    "Portfolio Agent checks concentration risk.",
    "Compliance Agent frames output as educational analysis.",
)
