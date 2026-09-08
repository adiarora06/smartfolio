"""Portfolio history from explicit dated account values and recorded cash flows.

The engine never reconstructs the past from today's holdings. It uses chained
Modified Dietz returns so a deposit or withdrawal between two sparse valuation
dates is weighted by when it occurred. The result remains an estimate because
the ledger and intraday flow timing cannot be proven from these records alone.
"""
from __future__ import annotations

import calendar
from datetime import date
from statistics import median
from typing import Dict, Iterable, List, Optional, Tuple

from ..schemas import (
    PerformanceCoverage,
    PerformanceEffectiveRange,
    PerformanceInterval,
    PerformancePoint,
    PerformanceRange,
    PerformanceRequestedRange,
    PerformanceSummary,
    PerformanceWarning,
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


def _subtract_months(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 - months
    year, zero_based_month = divmod(month_index, 12)
    month = zero_based_month + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _requested_dates(
    requested: PerformanceRange,
    latest: Optional[date],
) -> Tuple[Optional[date], Optional[date]]:
    end = date.fromisoformat(requested.end_date) if requested.end_date else latest
    if requested.start_date:
        start = date.fromisoformat(requested.start_date)
    elif end is None or requested.preset == "all":
        start = None
    elif requested.preset == "ytd":
        start = date(end.year, 1, 1)
    else:
        months = {"1m": 1, "3m": 3, "6m": 6, "1y": 12}.get(requested.preset)
        start = _subtract_months(end, months) if months else None
    return start, end


def _deduplicate_snapshots(
    valuations: Iterable[ValuationSnapshot],
) -> Tuple[List[ValuationSnapshot], List[PerformanceWarning], List[str]]:
    """Return one stable record per date and disclose conflicting duplicates."""

    by_date: Dict[str, List[ValuationSnapshot]] = {}
    for snapshot in valuations:
        by_date.setdefault(snapshot.date, []).append(snapshot)

    snapshots: List[ValuationSnapshot] = []
    warnings: List[PerformanceWarning] = []
    conflicting_dates: List[str] = []
    for snapshot_date in sorted(by_date):
        rows = sorted(by_date[snapshot_date], key=lambda row: row.id)
        snapshots.append(rows[-1])
        if len(rows) < 2:
            continue
        signatures = {
            (row.value, row.benchmark_symbol, row.benchmark_value) for row in rows
        }
        is_conflicting = len(signatures) > 1
        if is_conflicting:
            conflicting_dates.append(snapshot_date)
        warnings.append(
            PerformanceWarning(
                code=(
                    "conflicting_valuation_date"
                    if is_conflicting
                    else "duplicate_valuation_date"
                ),
                message=(
                    "Conflicting account values share this date; returns are unavailable until the duplicate is resolved."
                    if is_conflicting
                    else "A repeated identical valuation date was counted once."
                ),
                dates=[snapshot_date],
            )
        )
    return snapshots, warnings, conflicting_dates


def _benchmark_coverage(
    snapshots: List[ValuationSnapshot],
) -> Tuple[str, str, Optional[float], str, List[Optional[float]], List[PerformanceWarning]]:
    if not snapshots:
        return "none", "none", None, "VOO", [], []

    symbol = snapshots[0].benchmark_symbol or "VOO"
    symbols = {snapshot.benchmark_symbol for snapshot in snapshots}
    mixed_symbols = len(symbols) > 1
    start = snapshots[0].benchmark_value
    end = snapshots[-1].benchmark_value
    can_compare = (
        len(snapshots) >= 2
        and not mixed_symbols
        and start is not None
        and start > 0
        and end is not None
        and end > 0
    )
    benchmark_return = end / start - 1.0 if can_compare else None
    indices: List[Optional[float]] = []
    for snapshot in snapshots:
        if (
            start is not None
            and start > 0
            and snapshot.benchmark_symbol == symbol
            and snapshot.benchmark_value is not None
        ):
            indices.append(snapshot.benchmark_value / start * 100.0)
        else:
            indices.append(None)

    observed = sum(value is not None for value in indices)
    series = (
        "none"
        if observed == 0
        else "complete"
        if observed == len(indices)
        else "partial"
    )
    warnings: List[PerformanceWarning] = []
    if mixed_symbols:
        warnings.append(
            PerformanceWarning(
                code="mixed_benchmark_symbols",
                message="Benchmark comparison requires one symbol across the selected range.",
                dates=[snapshot.date for snapshot in snapshots],
            )
        )
    elif len(snapshots) >= 2 and not can_compare:
        warnings.append(
            PerformanceWarning(
                code="benchmark_boundaries_missing",
                message="Benchmark return needs values at both effective range boundaries.",
            )
        )
    elif series == "partial":
        warnings.append(
            PerformanceWarning(
                code="partial_benchmark_series",
                message="The benchmark summary is available, but some intermediate chart values are missing.",
            )
        )
    return (
        "complete" if can_compare else "none",
        series,
        benchmark_return,
        symbol,
        indices,
        warnings,
    )


def _empty_summary(
    requested: PerformanceRange,
    requested_start: Optional[date],
    requested_end: Optional[date],
    net_contributions: float,
    warnings: List[PerformanceWarning],
) -> PerformanceSummary:
    warnings.append(
        PerformanceWarning(
            code="insufficient_valuations",
            message="At least two dated account values are required for a return estimate.",
        )
    )
    return PerformanceSummary(
        measured=False,
        benchmark_symbol="VOO",
        start_date=None,
        end_date=None,
        current_value=0.0,
        net_contributions=net_contributions,
        gain=None,
        total_return=None,
        benchmark_return=None,
        excess_return=None,
        max_drawdown=None,
        observations=0,
        source="manual",
        points=[],
        requested_range=PerformanceRequestedRange(
            preset=requested.preset,
            start_date=requested_start.isoformat() if requested_start else None,
            end_date=requested_end.isoformat() if requested_end else None,
        ),
        effective_range=PerformanceEffectiveRange(),
        coverage=PerformanceCoverage(
            calculation_status="unavailable",
            valuation_points=0,
            interval_count=0,
            valid_interval_count=0,
            external_flow_count=0,
            median_valuation_gap_days=None,
            benchmark_summary="none",
            benchmark_series="none",
        ),
        warnings=warnings,
    )


def calculate_performance(
    transactions: List[PortfolioTransaction],
    valuations: List[ValuationSnapshot],
    requested: Optional[PerformanceRange] = None,
) -> PerformanceSummary:
    requested = requested or PerformanceRange()
    snapshots, warnings, conflicting_dates = _deduplicate_snapshots(
        snapshot for snapshot in valuations if snapshot.value >= 0
    )
    activity = sorted(
        transactions, key=lambda transaction: (transaction.date, transaction.id)
    )
    latest = date.fromisoformat(snapshots[-1].date) if snapshots else None
    requested_start, requested_end = _requested_dates(requested, latest)

    selected = [
        snapshot
        for snapshot in snapshots
        if (requested_start is None or date.fromisoformat(snapshot.date) >= requested_start)
        and (requested_end is None or date.fromisoformat(snapshot.date) <= requested_end)
    ]
    warnings = [
        warning
        for warning in warnings
        if not warning.dates
        or any(
            (requested_start is None or date.fromisoformat(item) >= requested_start)
            and (requested_end is None or date.fromisoformat(item) <= requested_end)
            for item in warning.dates
        )
    ]
    compatibility_end = (
        selected[-1].date
        if selected
        else requested_end.isoformat()
        if requested_end
        else None
    )
    net_contributions = sum(
        _external_flow(transaction)
        for transaction in activity
        if compatibility_end is None or transaction.date <= compatibility_end
    )

    if not selected:
        return _empty_summary(
            requested,
            requested_start,
            requested_end,
            net_contributions,
            warnings,
        )

    first = selected[0]
    last = selected[-1]
    effective_start = date.fromisoformat(first.date)
    effective_end = date.fromisoformat(last.date)
    day_count = max((effective_end - effective_start).days, 0)
    effective_flows = [
        transaction
        for transaction in activity
        if first.date < transaction.date <= last.date
        and _external_flow(transaction) != 0
    ]
    net_external_flow = sum(
        _external_flow(transaction) for transaction in effective_flows
    )
    selected_has_conflict = any(
        first.date <= item <= last.date for item in conflicting_dates
    )
    investment_gain = (
        last.value - first.value - net_external_flow
        if len(selected) >= 2 and not selected_has_conflict
        else None
    )

    (
        benchmark_summary,
        benchmark_series,
        benchmark_return,
        benchmark_symbol,
        benchmark_indices,
        benchmark_warnings,
    ) = _benchmark_coverage(selected)
    warnings.extend(benchmark_warnings)

    cumulative_contributions = sum(
        _external_flow(transaction)
        for transaction in activity
        if transaction.date <= first.date
    )
    portfolio_index = 100.0
    peak = portfolio_index
    max_drawdown = 0.0
    points = [
        PerformancePoint(
            date=first.date,
            value=first.value,
            cumulative_contributions=cumulative_contributions,
            portfolio_index=portfolio_index,
            benchmark_index=benchmark_indices[0] if benchmark_indices else None,
            external_flow=0.0,
            period_return=None,
            drawdown=0.0,
        )
    ]
    intervals: List[PerformanceInterval] = []
    all_intervals_valid = not selected_has_conflict

    for index, (previous, current) in enumerate(
        zip(selected, selected[1:]), start=1
    ):
        start = date.fromisoformat(previous.date)
        end = date.fromisoformat(current.date)
        interval_days = (end - start).days
        interval_activity = [
            transaction
            for transaction in activity
            if previous.date < transaction.date <= current.date
            and _external_flow(transaction) != 0
        ]
        external_flow = sum(
            _external_flow(transaction) for transaction in interval_activity
        )
        weighted_external_flow = (
            sum(
                _external_flow(transaction)
                * ((end - date.fromisoformat(transaction.date)).days / interval_days)
                for transaction in interval_activity
            )
            if interval_days > 0
            else 0.0
        )
        denominator = previous.value + weighted_external_flow
        interval_return = (
            (current.value - previous.value - external_flow) / denominator
            if interval_days > 0 and denominator > 0
            else None
        )
        valid = interval_return is not None and interval_return >= -1.0
        if not valid:
            all_intervals_valid = False
            warnings.append(
                PerformanceWarning(
                    code="invalid_performance_interval",
                    message="This interval has a nonpositive capital base or inconsistent cash flows, so the range return is unavailable.",
                    dates=[previous.date, current.date],
                )
            )
        else:
            portfolio_index *= 1.0 + interval_return
            peak = max(peak, portfolio_index)
            if peak > 0:
                max_drawdown = min(max_drawdown, portfolio_index / peak - 1.0)

        cumulative_contributions += external_flow
        intervals.append(
            PerformanceInterval(
                start_date=previous.date,
                end_date=current.date,
                day_count=interval_days,
                external_flow=external_flow,
                weighted_external_flow=weighted_external_flow,
                return_value=interval_return if valid else None,
                valid=valid,
            )
        )
        points.append(
            PerformancePoint(
                date=current.date,
                value=current.value,
                cumulative_contributions=cumulative_contributions,
                portfolio_index=portfolio_index,
                benchmark_index=benchmark_indices[index],
                external_flow=external_flow,
                period_return=interval_return if valid else None,
                drawdown=(
                    portfolio_index / peak - 1.0 if valid and peak > 0 else 0.0
                ),
            )
        )

    interval_count = len(intervals)
    valid_interval_count = sum(interval.valid for interval in intervals)
    complete = (
        len(selected) >= 2
        and all_intervals_valid
        and valid_interval_count == interval_count
    )
    calculation_status = (
        "unavailable"
        if len(selected) < 2 or valid_interval_count == 0 or selected_has_conflict
        else "complete"
        if complete
        else "partial"
    )
    estimated_return = portfolio_index / 100.0 - 1.0 if complete else None
    annualized_return = None
    if estimated_return is not None and estimated_return > -1.0 and day_count >= 365:
        annualized_return = (1.0 + estimated_return) ** (365.0 / day_count) - 1.0
    excess_return = (
        estimated_return - benchmark_return
        if estimated_return is not None and benchmark_return is not None
        else None
    )
    gaps = [
        (date.fromisoformat(current.date) - date.fromisoformat(previous.date)).days
        for previous, current in zip(selected, selected[1:])
    ]
    median_gap = float(median(gaps)) if gaps else None
    if median_gap is not None and median_gap > 45:
        warnings.append(
            PerformanceWarning(
                code="sparse_valuation_history",
                message="Valuations are sparse; returns and drawdown may miss changes between recorded dates.",
            )
        )
    if len(selected) < 2:
        warnings.append(
            PerformanceWarning(
                code="insufficient_valuations",
                message="At least two dated account values are required for a return estimate.",
            )
        )
    warnings.append(
        PerformanceWarning(
            code="ledger_completeness_unknown",
            message="SmartFolio cannot verify that every external cash flow is present in the ledger.",
        )
    )

    return PerformanceSummary(
        measured=complete,
        benchmark_symbol=benchmark_symbol,
        start_date=first.date,
        end_date=last.date,
        current_value=last.value,
        net_contributions=net_contributions,
        gain=investment_gain if complete else None,
        total_return=estimated_return,
        benchmark_return=benchmark_return,
        excess_return=excess_return,
        max_drawdown=max_drawdown if complete else None,
        observations=len(selected),
        source=_source(selected),  # type: ignore[arg-type]
        points=points,
        requested_range=PerformanceRequestedRange(
            preset=requested.preset,
            start_date=requested_start.isoformat() if requested_start else None,
            end_date=requested_end.isoformat() if requested_end else None,
        ),
        effective_range=PerformanceEffectiveRange(
            start_date=first.date,
            end_date=last.date,
            day_count=day_count,
        ),
        estimated_return=estimated_return,
        annualized_return=annualized_return,
        net_external_flow=net_external_flow,
        investment_gain=investment_gain,
        current_drawdown=points[-1].drawdown if complete else None,
        coverage=PerformanceCoverage(
            calculation_status=calculation_status,
            valuation_points=len(selected),
            interval_count=interval_count,
            valid_interval_count=valid_interval_count,
            external_flow_count=len(effective_flows),
            median_valuation_gap_days=median_gap,
            benchmark_summary=benchmark_summary,  # type: ignore[arg-type]
            benchmark_series=benchmark_series,  # type: ignore[arg-type]
        ),
        intervals=intervals,
        warnings=warnings,
    )
