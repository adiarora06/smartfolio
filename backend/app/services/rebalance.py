"""Deterministic, preview-only portfolio rebalancing.

The planner works in integer cents so its projected holdings and cash always
reconcile exactly. Targets are asset-class weights; it does not invent tickers
or share counts that the holdings contract cannot support.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP
from typing import Dict, Iterable, List, Tuple, cast

from ..schemas import (
    AssetClass,
    Holding,
    RebalancePlanRequest,
    RebalancePlanResponse,
    RebalanceTargetSource,
    RebalanceTrade,
    RebalanceWarning,
    RiskProfileName,
)
from .data import TARGETS
from .portfolio import risk_profile

CENT = Decimal("0.01")
ASSET_ORDER: Tuple[AssetClass, ...] = (
    "us_equity",
    "intl_equity",
    "bonds",
    "cash",
    "alternatives",
    "crypto",
    "other",
)


def _to_cents(value: float) -> int:
    return int(
        (Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP) * 100)
        .to_integral_value()
    )


def _dollars(cents: int) -> float:
    return float(Decimal(cents) / 100)


def _asset_label(asset: AssetClass) -> str:
    return asset.replace("_", " ").title()


def _allocation(asset_values: Dict[AssetClass, int], total: int) -> Dict[str, float]:
    return {
        asset: (asset_values.get(asset, 0) / total if total else 0.0)
        for asset in ASSET_ORDER
    }


def _target_for(
    request: RebalancePlanRequest,
) -> Tuple[Dict[AssetClass, Decimal], RebalanceTargetSource, RiskProfileName | None]:
    if request.target_allocation is not None:
        raw = request.target_allocation
        source: RebalanceTargetSource = "custom"
        name = None
    elif request.target_profile is not None:
        raw = cast(Dict[AssetClass, float], TARGETS[request.target_profile])
        source = "risk_profile"
        name = request.target_profile
    else:
        # Request validation guarantees profile exists in this branch.
        assert request.profile is not None
        name = cast(RiskProfileName, risk_profile(request.profile)[0])
        raw = cast(Dict[AssetClass, float], TARGETS[name])
        source = "risk_profile"

    weights = {
        asset: Decimal(str(raw.get(asset, 0.0))) for asset in ASSET_ORDER
    }
    # Validation permits a tiny floating-point sum tolerance. Normalize here so
    # target cents still reconcile to the exact post-contribution total.
    weight_sum = sum(weights.values(), Decimal(0))
    return (
        {asset: weight / weight_sum for asset, weight in weights.items()},
        source,
        name,
    )


def _target_cents(
    total: int, weights: Dict[AssetClass, Decimal]
) -> Dict[AssetClass, int]:
    """Largest-remainder allocation; target dollars add to ``total`` exactly."""
    raw = {asset: Decimal(total) * weights[asset] for asset in ASSET_ORDER}
    allocated = {
        asset: int(value.to_integral_value(rounding=ROUND_FLOOR))
        for asset, value in raw.items()
    }
    remaining = total - sum(allocated.values())
    ranked = sorted(
        ASSET_ORDER,
        key=lambda asset: (-(raw[asset] - allocated[asset]), ASSET_ORDER.index(asset)),
    )
    for asset in ranked[:remaining]:
        allocated[asset] += 1
    return allocated


def _proportional_buys(
    gaps: Dict[AssetClass, int], budget: int, minimum: int
) -> Tuple[Dict[AssetClass, int], List[AssetClass]]:
    """Spread available cash across positive gaps, exactly to the cent.

    Assets whose resulting order would miss the minimum are removed and the
    cash is redistributed across the remaining gaps. The returned skipped list
    lets the caller explain why an intended target received no order.
    """
    eligible = {
        asset: gap
        for asset, gap in gaps.items()
        if gap > 0 and (minimum == 0 or gap >= minimum)
    }
    skipped = [
        asset
        for asset, gap in gaps.items()
        if gap > 0 and minimum > 0 and gap < minimum
    ]
    if budget <= 0 or not eligible:
        return {}, skipped

    while eligible:
        spend = min(budget, sum(eligible.values()))
        gap_total = sum(eligible.values())
        raw = {
            asset: Decimal(spend) * Decimal(gap) / Decimal(gap_total)
            for asset, gap in eligible.items()
        }
        allocations = {
            asset: int(value.to_integral_value(rounding=ROUND_FLOOR))
            for asset, value in raw.items()
        }
        remaining = spend - sum(allocations.values())
        ranked = sorted(
            eligible,
            key=lambda asset: (
                -(raw[asset] - allocations[asset]),
                ASSET_ORDER.index(asset),
            ),
        )
        for asset in ranked[:remaining]:
            allocations[asset] += 1

        below = [
            asset
            for asset, amount in allocations.items()
            if 0 < amount < minimum
        ]
        if not below:
            return allocations, skipped
        for asset in below:
            skipped.append(asset)
            eligible.pop(asset)
    return {}, skipped


def _asset_values(
    holdings: Iterable[Holding], values: Iterable[int]
) -> Dict[AssetClass, int]:
    totals: Dict[AssetClass, int] = defaultdict(int)
    for holding, value in zip(holdings, values):
        totals[holding.asset] += value
    return {asset: totals.get(asset, 0) for asset in ASSET_ORDER}


def _warning(
    warnings: List[RebalanceWarning],
    code: str,
    message: str,
    asset: AssetClass | None = None,
    amount: int | None = None,
) -> None:
    warnings.append(
        RebalanceWarning(
            code=code,  # type: ignore[arg-type]
            message=message,
            asset=asset,
            amount=_dollars(amount) if amount is not None else None,
        )
    )


def _sell_from_existing(
    asset: AssetClass,
    amount: int,
    holdings: List[Holding],
    projected: List[int],
    trades: List[RebalanceTrade],
) -> int:
    """Sell largest positions first, minimizing line items with stable ties."""
    indices = [
        index for index, holding in enumerate(holdings) if holding.asset == asset
    ]
    indices.sort(
        key=lambda index: (
            -projected[index],
            holdings[index].symbol.upper(),
            holdings[index].name,
            index,
        )
    )
    remaining = amount
    for index in indices:
        if remaining <= 0:
            break
        before = projected[index]
        sold = min(before, remaining)
        if sold <= 0:
            continue
        projected[index] -= sold
        remaining -= sold
        trades.append(
            RebalanceTrade(
                symbol=holdings[index].symbol,
                name=holdings[index].name,
                asset=asset,
                action="sell",
                amount=_dollars(sold),
                before_value=_dollars(before),
                after_value=_dollars(projected[index]),
                resolved=True,
            )
        )
    if remaining:
        raise AssertionError("asset sell exceeded available holding value")
    return amount


def _buy_existing_or_unresolved(
    asset: AssetClass,
    amount: int,
    holdings: List[Holding],
    projected: List[int],
    trades: List[RebalanceTrade],
) -> bool:
    """Route a buy to the largest existing position; never invent a ticker."""
    indices = [
        index for index, holding in enumerate(holdings) if holding.asset == asset
    ]
    if not indices:
        trades.append(
            RebalanceTrade(
                symbol=None,
                name=None,
                asset=asset,
                action="buy",
                amount=_dollars(amount),
                before_value=None,
                after_value=None,
                resolved=False,
            )
        )
        return False

    index = min(
        indices,
        key=lambda item: (
            -projected[item],
            holdings[item].symbol.upper(),
            holdings[item].name,
            item,
        ),
    )
    before = projected[index]
    projected[index] += amount
    trades.append(
        RebalanceTrade(
            symbol=holdings[index].symbol,
            name=holdings[index].name,
            asset=asset,
            action="buy",
            amount=_dollars(amount),
            before_value=_dollars(before),
            after_value=_dollars(projected[index]),
            resolved=True,
        )
    )
    return True


def _warn_new_money_limits(
    current: Dict[AssetClass, int],
    before_total: int,
    contribution: int,
    weights: Dict[AssetClass, Decimal],
    warnings: List[RebalanceWarning],
) -> None:
    impossible_assets = [
        asset
        for asset in ASSET_ORDER
        if current[asset] > 0 and weights[asset] == 0
    ]
    for asset in impossible_assets:
        _warning(
            warnings,
            "sell_required",
            f"{_asset_label(asset)} has a 0% target and cannot be removed with new money only.",
            asset,
            current[asset],
        )
    if impossible_assets:
        return

    minimum_total = Decimal(before_total)
    for asset in ASSET_ORDER:
        if current[asset] > 0 and weights[asset] > 0:
            minimum_total = max(minimum_total, Decimal(current[asset]) / weights[asset])
    required_total = int(minimum_total.to_integral_value(rounding=ROUND_CEILING))
    required_contribution = max(0, required_total - before_total)
    if contribution < required_contribution:
        shortfall = required_contribution - contribution
        _warning(
            warnings,
            "new_money_insufficient",
            "The selected contribution cannot reach the target without selling; "
            f"at least ${_dollars(shortfall):,.2f} more is required.",
            amount=shortfall,
        )


def plan_rebalance(request: RebalancePlanRequest) -> RebalancePlanResponse:
    """Return an exact-cent preview without executing or persisting anything."""
    holdings = request.holdings
    projected = [_to_cents(holding.value) for holding in holdings]
    before_total = sum(projected)
    contribution = _to_cents(request.contribution_amount)
    minimum = _to_cents(request.min_trade_amount)
    after_total = before_total + contribution
    target_weights, target_source, target_name = _target_for(request)
    current = _asset_values(holdings, projected)
    target = _target_cents(after_total, target_weights)
    delta = {asset: target[asset] - current[asset] for asset in ASSET_ORDER}
    warnings: List[RebalanceWarning] = []
    trades: List[RebalanceTrade] = []

    if after_total == 0:
        _warning(
            warnings,
            "empty_portfolio",
            "Add a holding or contribution before creating a rebalance plan.",
        )

    if request.mode == "new_money_only":
        _warn_new_money_limits(
            current, before_total, contribution, target_weights, warnings
        )

    cash_budget = contribution
    total_sells = 0
    total_buys = 0
    unresolved_reserved = 0

    if request.mode == "rebalance":
        for asset in ASSET_ORDER:
            wanted = -delta[asset]
            if wanted <= 0:
                continue
            if wanted < minimum:
                _warning(
                    warnings,
                    "below_minimum_trade",
                    f"Skipped a ${_dollars(wanted):,.2f} {_asset_label(asset)} reduction below the minimum trade.",
                    asset,
                    wanted,
                )
                continue
            total_sells += _sell_from_existing(
                asset, wanted, holdings, projected, trades
            )
            cash_budget += wanted

    buy_allocations, skipped_buys = _proportional_buys(
        delta, cash_budget, minimum
    )
    for asset in skipped_buys:
        wanted = delta[asset]
        if wanted > 0:
            _warning(
                warnings,
                "below_minimum_trade",
                f"Skipped the {_asset_label(asset)} addition because its order would be below the minimum trade.",
                asset,
                wanted,
            )

    for asset in sorted(
        buy_allocations,
        key=lambda item: (-buy_allocations[item], ASSET_ORDER.index(item)),
    ):
        wanted = delta[asset]
        planned = buy_allocations[asset]
        if planned <= 0:
            continue
        cash_budget -= planned
        if planned < wanted:
            _warning(
                warnings,
                "cash_constraint",
                f"The {_asset_label(asset)} target remains ${_dollars(wanted - planned):,.2f} underfunded.",
                asset,
                wanted - planned,
            )
        if _buy_existing_or_unresolved(asset, planned, holdings, projected, trades):
            total_buys += planned
        else:
            unresolved_reserved += planned
            _warning(
                warnings,
                "unresolved_buy_target",
                f"Choose a holding for the {_asset_label(asset)} allocation before applying this plan.",
                asset,
                planned,
            )

    funded_assets = set(buy_allocations)
    for asset in ASSET_ORDER:
        if (
            delta[asset] > 0
            and asset not in funded_assets
            and asset not in skipped_buys
        ):
            _warning(
                warnings,
                "cash_constraint",
                f"No eligible cash remains for the {_asset_label(asset)} target gap.",
                asset,
                delta[asset],
            )

    # Cash that could not clear a target/minimum constraint is still part of
    # the post-contribution portfolio. When a cash holding already exists,
    # represent it there so projectedHoldings remains directly applicable.
    if cash_budget > 0 and any(holding.asset == "cash" for holding in holdings):
        cash_to_holding = cash_budget
        if _buy_existing_or_unresolved(
            "cash", cash_to_holding, holdings, projected, trades
        ):
            total_buys += cash_to_holding
            cash_budget = 0

    cash_remaining = cash_budget
    projected_assets = _asset_values(holdings, projected)
    for trade in trades:
        if trade.action == "buy" and not trade.resolved:
            projected_assets[trade.asset] += _to_cents(trade.amount)
    projected_assets["cash"] += cash_remaining
    exact_target_reached = after_total > 0 and all(
        abs(projected_assets[asset] - target[asset]) <= 1 for asset in ASSET_ORDER
    )
    if after_total > 0 and not exact_target_reached:
        _warning(
            warnings,
            "target_not_reached",
            "The preview improves the allocation but does not exactly reach every target weight.",
        )
    if cash_remaining > 0:
        _warning(
            warnings,
            "uninvested_cash",
            f"${_dollars(cash_remaining):,.2f} remains outside the projected holdings.",
            "cash",
            cash_remaining,
        )

    unresolved = any(not trade.resolved for trade in trades)
    resolved_count = sum(1 for trade in trades if trade.resolved)
    can_apply = (
        after_total > 0
        and not unresolved
        and cash_remaining == 0
        and (resolved_count > 0 or exact_target_reached)
    )
    projected_holdings = [
        holding.model_copy(update={"value": _dollars(projected[index])})
        for index, holding in enumerate(holdings)
    ]

    return RebalancePlanResponse(
        mode=request.mode,
        before_total=_dollars(before_total),
        after_total=_dollars(after_total),
        total_traded=_dollars(total_sells + total_buys + unresolved_reserved),
        estimated_trades=len(trades),
        before_allocation=_allocation(current, before_total),
        after_allocation=_allocation(projected_assets, after_total),
        target_allocation={
            asset: float(target_weights[asset]) for asset in ASSET_ORDER
        },
        trades=trades,
        projected_holdings=projected_holdings,
        warnings=warnings,
        can_apply=can_apply,
        target_source=target_source,
        target_profile=target_name,
        total_buys=_dollars(total_buys + unresolved_reserved),
        total_sells=_dollars(total_sells),
        unresolved_amount=_dollars(unresolved_reserved),
        cash_remaining=_dollars(cash_remaining),
        exact_target_reached=exact_target_reached,
        preview_only=True,
    )
