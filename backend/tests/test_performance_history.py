"""Contract tests for the cash-flow-aware Portfolio History engine."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas import (
    PerformanceRange,
    PortfolioTransaction,
    ValuationSnapshot,
)
from app.services.performance import calculate_performance


def valuation(
    snapshot_id: str,
    date: str,
    value: float,
    benchmark: float | None = None,
    symbol: str = "VOO",
) -> ValuationSnapshot:
    return ValuationSnapshot(
        id=snapshot_id,
        date=date,
        value=value,
        benchmark_symbol=symbol,
        benchmark_value=benchmark,
        source="imported",
    )


def flow(
    transaction_id: str,
    date: str,
    amount: float,
    flow_type: str = "deposit",
) -> PortfolioTransaction:
    return PortfolioTransaction(
        id=transaction_id,
        date=date,
        type=flow_type,
        amount=amount,
        source="imported",
    )


def test_modified_dietz_weights_a_mid_period_deposit():
    performance = calculate_performance(
        [flow("cash", "2026-01-06", 50)],
        [
            valuation("start", "2026-01-01", 100, 100),
            valuation("end", "2026-01-11", 165, 110),
        ],
    )

    assert performance.estimated_return == pytest.approx(0.12)
    assert performance.total_return == pytest.approx(0.12)
    assert performance.investment_gain == pytest.approx(15)
    assert performance.intervals[0].weighted_external_flow == pytest.approx(25)
    assert performance.method == "modified_dietz"
    assert performance.precision == "estimated"


def test_opening_flow_is_embedded_and_end_flow_has_zero_weight():
    opening = calculate_performance(
        [flow("opening", "2026-01-01", 100)],
        [
            valuation("start", "2026-01-01", 100),
            valuation("end", "2026-01-11", 110),
        ],
    )
    ending = calculate_performance(
        [flow("ending", "2026-01-11", 50)],
        [
            valuation("start", "2026-01-01", 100),
            valuation("end", "2026-01-11", 160),
        ],
    )

    assert opening.net_external_flow == 0
    assert opening.estimated_return == pytest.approx(0.10)
    assert ending.net_external_flow == 50
    assert ending.intervals[0].weighted_external_flow == 0
    assert ending.estimated_return == pytest.approx(0.10)


def test_withdrawals_and_multiple_intervals_chain_geometrically():
    withdrawal = calculate_performance(
        [flow("withdrawal", "2026-01-06", 50, "withdrawal")],
        [
            valuation("start", "2026-01-01", 100),
            valuation("end", "2026-01-11", 65),
        ],
    )
    chained = calculate_performance(
        [],
        [
            valuation("a", "2026-01-01", 100),
            valuation("b", "2026-02-01", 110),
            valuation("c", "2026-03-01", 121),
        ],
    )

    assert withdrawal.estimated_return == pytest.approx(0.20)
    assert chained.estimated_return == pytest.approx(0.21)
    assert [point.period_return for point in chained.points] == [
        None,
        pytest.approx(0.10),
        pytest.approx(0.10),
    ]


def test_range_uses_latest_observation_and_never_widens():
    snapshots = [
        valuation("a", "2025-01-01", 100),
        valuation("b", "2026-01-01", 110),
        valuation("c", "2026-04-01", 121),
        valuation("d", "2026-07-01", 133.10),
    ]

    six_months = calculate_performance(
        [], snapshots, PerformanceRange(preset="6m")
    )
    one_month = calculate_performance(
        [], snapshots, PerformanceRange(preset="1m")
    )

    assert six_months.requested_range.start_date == "2026-01-01"
    assert six_months.effective_range.start_date == "2026-01-01"
    assert six_months.effective_range.end_date == "2026-07-01"
    assert six_months.estimated_return == pytest.approx(0.21)
    assert one_month.observations == 1
    assert one_month.estimated_return is None
    assert one_month.benchmark_return is None
    assert one_month.coverage.calculation_status == "unavailable"


def test_rolling_range_clamps_to_the_last_day_of_shorter_months():
    performance = calculate_performance(
        [],
        [
            valuation("start", "2026-02-28", 100),
            valuation("end", "2026-08-31", 110),
        ],
        PerformanceRange(preset="6m"),
    )

    assert performance.requested_range.start_date == "2026-02-28"
    assert performance.estimated_return == pytest.approx(0.10)


def test_invalid_capital_base_and_conflicting_duplicates_do_not_claim_return():
    invalid = calculate_performance(
        [],
        [
            valuation("a", "2026-01-01", 0),
            valuation("b", "2026-02-01", 10),
        ],
    )
    duplicate = calculate_performance(
        [],
        [
            valuation("a", "2026-01-01", 100),
            valuation("b", "2026-01-01", 120),
            valuation("c", "2026-02-01", 130),
        ],
    )

    assert invalid.estimated_return is None
    assert invalid.coverage.calculation_status == "unavailable"
    assert invalid.total_return is None
    assert invalid.max_drawdown is None
    assert invalid.gain is None
    assert duplicate.estimated_return is None
    assert duplicate.coverage.calculation_status == "unavailable"
    assert duplicate.total_return is None
    assert duplicate.max_drawdown is None
    assert duplicate.gain is None
    assert any(
        warning.code == "conflicting_valuation_date"
        for warning in duplicate.warnings
    )


def test_conflict_outside_requested_range_does_not_poison_selected_history():
    performance = calculate_performance(
        [],
        [
            valuation("old-a", "2025-01-01", 90),
            valuation("old-b", "2025-01-01", 100),
            valuation("start", "2026-01-01", 100),
            valuation("end", "2026-02-01", 110),
        ],
        PerformanceRange(
            preset="custom",
            start_date="2026-01-01",
            end_date="2026-02-01",
        ),
    )

    assert performance.estimated_return == pytest.approx(0.10)
    assert performance.coverage.calculation_status == "complete"
    assert not any(
        warning.code == "conflicting_valuation_date"
        for warning in performance.warnings
    )


def test_benchmark_requires_matching_symbols_at_effective_boundaries():
    performance = calculate_performance(
        [],
        [
            valuation("a", "2026-01-01", 100, 100, "VOO"),
            valuation("b", "2026-02-01", 110, 105, "SPY"),
        ],
    )

    assert performance.benchmark_return is None
    assert performance.excess_return is None
    assert performance.coverage.benchmark_summary == "none"
    assert any(warning.code == "mixed_benchmark_symbols" for warning in performance.warnings)


def test_dates_and_custom_ranges_are_calendar_validated():
    with pytest.raises(ValidationError):
        valuation("bad", "2026-02-30", 100)
    with pytest.raises(ValidationError):
        PerformanceRange(preset="custom", start_date="2026-01-01")
    with pytest.raises(ValidationError):
        PerformanceRange(
            preset="custom",
            start_date="2026-02-01",
            end_date="2026-01-01",
        )


def test_api_uses_camel_case_history_contract(client):
    response = client.post(
        "/portfolio/performance",
        json={
            "transactions": [
                {
                    "id": "mid",
                    "date": "2026-01-06",
                    "type": "deposit",
                    "amount": 50,
                    "source": "imported",
                }
            ],
            "valuations": [
                {
                    "id": "start",
                    "date": "2026-01-01",
                    "value": 100,
                    "benchmarkSymbol": "VOO",
                    "benchmarkValue": 100,
                    "source": "imported",
                },
                {
                    "id": "end",
                    "date": "2026-01-11",
                    "value": 165,
                    "benchmarkSymbol": "VOO",
                    "benchmarkValue": 110,
                    "source": "imported",
                },
            ],
            "range": {"preset": "all"},
        },
    )

    assert response.status_code == 200
    performance = response.json()["performance"]
    assert performance["estimatedReturn"] == pytest.approx(0.12)
    assert performance["totalReturn"] == pytest.approx(0.12)
    assert performance["maxDrawdown"] == pytest.approx(0)
    assert performance["effectiveRange"]["dayCount"] == 10
    assert performance["coverage"]["calculationStatus"] == "complete"
    assert performance["intervals"][0]["weightedExternalFlow"] == pytest.approx(25)
