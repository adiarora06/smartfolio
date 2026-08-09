"""Cash-flow-adjusted portfolio performance from explicit valuation history.

The service deliberately refuses to reconstruct past values from today's
holdings. Returns become measured only when at least two dated valuations are
present; deposits and withdrawals are removed from each sub-period before the
time-weighted return is chained.
"""
from __future__ import annotations

from typing import Dict, List

from ..schemas import (
    PerformancePoint,
    PerformanceSummary,
    PortfolioTransaction,
    ValuationSnapshot,
)


def _external_flow(transaction: PortfolioTransaction) -> float:
    if transaction.type == "deposit":
        return transaction.amount
    if transaction.type == "withdrawal":
        return -transaction.amount
    return 0.0


def _source(snapshots: List[ValuationSnapshot]) -> str:
    sources = {snapshot.source for snapshot in snapshots}
    if len(sources) != 1:
        return "mixed"
    return next(iter(sources), "manual")


def calculate_performance(
    transactions: List[PortfolioTransaction], valuations: List[ValuationSnapshot]
) -> PerformanceSummary:
    snapshots = sorted(
        (snapshot for snapshot in valuations if snapshot.value >= 0),
        key=lambda snapshot: snapshot.date,
    )
    activity = sorted(transactions, key=lambda transaction: transaction.date)
    benchmark_symbol = next(
        (snapshot.benchmark_symbol for snapshot in snapshots if snapshot.benchmark_symbol),
        "VOO",
    )
    end_date = snapshots[-1].date if snapshots else None
    net_contributions = sum(
        _external_flow(transaction)
        for transaction in activity
        if end_date is None or transaction.date <= end_date
    )
    current_value = snapshots[-1].value if snapshots else 0.0
    gain = current_value - net_contributions

    if not snapshots:
        return PerformanceSummary(
            measured=False,
            benchmark_symbol=benchmark_symbol,
            start_date=None,
            end_date=None,
            current_value=0.0,
            net_contributions=net_contributions,
            gain=-net_contributions,
            total_return=0.0,
            benchmark_return=None,
            excess_return=None,
            max_drawdown=0.0,
            observations=0,
            source="manual",
            points=[],
        )

    flows_by_date: Dict[str, float] = {}
    for transaction in activity:
        flows_by_date[transaction.date] = flows_by_date.get(
            transaction.date, 0.0
        ) + _external_flow(transaction)

    portfolio_index = 100.0
    peak = portfolio_index
    max_drawdown = 0.0
    first = snapshots[0]
    cumulative_contributions = sum(
        flow for date, flow in flows_by_date.items() if date <= first.date
    )
    benchmark_start = first.benchmark_value
    points = [
        PerformancePoint(
            date=first.date,
            value=first.value,
            cumulative_contributions=cumulative_contributions,
            portfolio_index=portfolio_index,
            benchmark_index=100.0
            if benchmark_start is not None and benchmark_start > 0
            else None,
        )
    ]

    for previous, current in zip(snapshots, snapshots[1:]):
        flow = sum(
            amount
            for date, amount in flows_by_date.items()
            if previous.date < date <= current.date
        )
        cumulative_contributions += flow
        segment_return = (
            (current.value - flow) / previous.value - 1.0
            if previous.value > 0
            else 0.0
        )
        portfolio_index *= max(0.0, 1.0 + segment_return)
        peak = max(peak, portfolio_index)
        if peak > 0:
            max_drawdown = min(max_drawdown, portfolio_index / peak - 1.0)
        benchmark_index = None
        if (
            benchmark_start is not None
            and benchmark_start > 0
            and current.benchmark_value is not None
        ):
            benchmark_index = current.benchmark_value / benchmark_start * 100.0
        points.append(
            PerformancePoint(
                date=current.date,
                value=current.value,
                cumulative_contributions=cumulative_contributions,
                portfolio_index=portfolio_index,
                benchmark_index=benchmark_index,
            )
        )

    measured = len(snapshots) >= 2
    total_return = portfolio_index / 100.0 - 1.0 if measured else 0.0
    benchmark_end = snapshots[-1].benchmark_value
    benchmark_return = None
    if (
        measured
        and benchmark_start is not None
        and benchmark_start > 0
        and benchmark_end is not None
    ):
        benchmark_return = benchmark_end / benchmark_start - 1.0

    return PerformanceSummary(
        measured=measured,
        benchmark_symbol=benchmark_symbol,
        start_date=first.date,
        end_date=end_date,
        current_value=current_value,
        net_contributions=net_contributions,
        gain=gain,
        total_return=total_return,
        benchmark_return=benchmark_return,
        excess_return=(
            total_return - benchmark_return if benchmark_return is not None else None
        ),
        max_drawdown=max_drawdown,
        observations=len(snapshots),
        source=_source(snapshots),  # type: ignore[arg-type]
        points=points,
    )
