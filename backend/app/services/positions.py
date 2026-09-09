"""Current-position enrichment and honest cost-basis coverage.

Portfolio value remains an explicit user/broker input. A quote refresh may
revalue a share-tracked position, but this service never reverse-engineers a
quantity from a dollar value and never treats missing cost basis as zero.
"""
from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List

from ..marketdata.resolver import MarketDataResolver, ResolvedQuote
from ..schemas import (
    Holding,
    PortfolioPosition,
    PortfolioPositionSummary,
    PortfolioPositionWarning,
    PortfolioPositionsRequest,
    PortfolioPositionsResponse,
    PositionPriceStatus,
)


def _money(value: float) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _warning(
    warnings: List[PortfolioPositionWarning],
    holding: Holding,
    code: str,
    message: str,
) -> None:
    warnings.append(
        PortfolioPositionWarning(
            code=code,
            message=message,
            holding_id=holding.id,
            symbol=holding.symbol,
        )
    )


def _stored_price_status(holding: Holding) -> PositionPriceStatus:
    if holding.current_price is None:
        return "unavailable"
    source = (holding.price_source or "manual").lower()
    if source in {"demo", "offline", "offline_reference", "reference"}:
        return "reference"
    if source == "manual":
        return "manual"
    if "stale" in source:
        return "stale"
    if "cache" in source:
        return "cached"
    return "current"


def _date_only(value: str | None) -> str | None:
    """Normalize provider timestamps to the holding contract's ISO date."""

    if not value:
        return None
    candidate = value[:10]
    try:
        date.fromisoformat(candidate)
    except ValueError:
        return None
    return candidate


async def _quotes_for(
    holdings: List[Holding], resolver: MarketDataResolver
) -> Dict[str, ResolvedQuote]:
    symbols = sorted({h.symbol for h in holdings if h.type != "cash" and h.symbol})
    semaphore = asyncio.Semaphore(8)

    async def resolve(symbol: str) -> tuple[str, ResolvedQuote]:
        async with semaphore:
            return symbol, await resolver.resolve_quote(symbol)

    if not symbols:
        return {}
    return dict(await asyncio.gather(*(resolve(symbol) for symbol in symbols)))


async def analyze_positions(
    request: PortfolioPositionsRequest,
    resolver: MarketDataResolver,
) -> PortfolioPositionsResponse:
    holdings = [holding.model_copy(deep=True) for holding in request.holdings]
    warnings: List[PortfolioPositionWarning] = []
    quote_by_symbol = (
        await _quotes_for(holdings, resolver) if request.refresh_prices else {}
    )
    refreshed_status: Dict[str, PositionPriceStatus] = {}

    for holding in holdings:
        resolved = quote_by_symbol.get(holding.symbol)
        if resolved is None:
            continue
        quote = resolved.snapshot
        if resolved.origin == "reference" and not request.allow_offline_reference_prices:
            _warning(
                warnings,
                holding,
                "offline_reference_not_applied",
                "No provider quote was available; the offline reference price was not applied.",
            )
            continue
        if quote.price is None or quote.price <= 0:
            _warning(
                warnings,
                holding,
                "price_unavailable",
                "No usable current price was available for this holding.",
            )
            continue

        price_source = (
            "offline_reference" if resolved.origin == "reference" else quote.source
        )
        status: PositionPriceStatus = {
            "cache": "cached",
            "stale": "stale",
            "reference": "reference",
        }.get(resolved.origin, "current")  # type: ignore[assignment]
        holding.current_price = quote.price
        holding.price_as_of = _date_only(quote.as_of)
        holding.price_source = price_source
        refreshed_status[holding.symbol] = status

        if holding.quantity is None:
            _warning(
                warnings,
                holding,
                "quantity_unavailable",
                "The quote was recorded, but portfolio value was preserved "
                "because quantity is missing.",
            )
        else:
            holding.value = _money(holding.quantity * quote.price)
        if resolved.origin == "stale":
            _warning(
                warnings,
                holding,
                "stale_price_applied",
                "The latest available provider quote is stale; review its as-of date.",
            )
        elif resolved.origin == "reference":
            _warning(
                warnings,
                holding,
                "offline_reference_applied",
                "An offline reference price was applied by explicit request; "
                "it is not a live quote.",
            )

    positions: List[PortfolioPosition] = []
    total_value = sum(holding.value for holding in holdings)
    security_value = sum(
        holding.value for holding in holdings if holding.type != "cash"
    )
    covered_value = 0.0
    covered_basis = 0.0
    covered_gain = 0.0
    quantity_value = 0.0
    priced_value = 0.0

    for holding in holdings:
        # Cash has no unrealized market gain; treating its current nominal
        # value as covered avoids making an ordinary cash allocation look like
        # missing security cost-basis data.
        effective_basis = (
            holding.value if holding.type == "cash" else holding.cost_basis
        )
        has_basis = effective_basis is not None
        gain = _money(holding.value - effective_basis) if has_basis else None
        gain_pct = (
            gain / effective_basis
            if gain is not None and effective_basis and effective_basis > 0
            else None
        )
        if has_basis:
            covered_value += holding.value
            covered_basis += effective_basis or 0.0
            covered_gain += gain or 0.0
        elif holding.type != "cash":
            _warning(
                warnings,
                holding,
                "cost_basis_unavailable",
                "Cost basis is missing, so unrealized gain is unavailable for this holding.",
            )
        if holding.type != "cash" and holding.quantity is not None:
            quantity_value += holding.value
        if (
            holding.type != "cash"
            and holding.quantity is not None
            and holding.current_price is not None
        ):
            priced_value += holding.value

        positions.append(
            PortfolioPosition(
                holding_id=holding.id,
                symbol=holding.symbol,
                market_value=holding.value,
                cost_basis=effective_basis,
                average_cost=holding.average_cost,
                unrealized_gain=gain,
                unrealized_gain_pct=gain_pct,
                valuation_mode=(
                    "quantity_priced"
                    if holding.quantity is not None and holding.current_price is not None
                    else "reported_value"
                ),
                gain_status="complete" if has_basis else "unavailable",
                price_status=refreshed_status.get(
                    holding.symbol, _stored_price_status(holding)
                ),
            )
        )

    basis_coverage = covered_value / total_value if total_value > 0 else 0.0
    quantity_coverage = quantity_value / security_value if security_value > 0 else 1.0
    priced_coverage = priced_value / security_value if security_value > 0 else 1.0
    calculation_status = (
        "complete"
        if holdings and abs(basis_coverage - 1.0) <= 1e-9
        else "partial" if covered_value > 0 else "unavailable"
    )
    summary_gain = _money(covered_gain) if covered_value > 0 else None
    summary_basis = _money(covered_basis) if covered_value > 0 else None

    return PortfolioPositionsResponse(
        holdings=holdings,
        positions=positions,
        summary=PortfolioPositionSummary(
            market_value=_money(total_value),
            covered_market_value=_money(covered_value),
            cost_basis=summary_basis,
            unrealized_gain=summary_gain,
            unrealized_gain_pct=(
                summary_gain / summary_basis
                if summary_gain is not None and summary_basis and summary_basis > 0
                else None
            ),
            cost_basis_coverage=basis_coverage,
            quantity_coverage=quantity_coverage,
            priced_coverage=priced_coverage,
            calculation_status=calculation_status,
        ),
        warnings=warnings,
    )
