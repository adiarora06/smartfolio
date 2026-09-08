"""Deterministic rebalancing planner contracts and accounting invariants."""
from __future__ import annotations

import pytest


PROFILE = {
    "age": 30,
    "income": 90000,
    "contribution": 1000,
    "horizon": 20,
    "risk": 3,
    "emergency": 6,
    "goal": "long_term_growth",
    "liquidity": "medium",
}


def _holding(symbol: str, asset: str, value: float, kind: str = "etf") -> dict:
    return {
        "symbol": symbol,
        "name": symbol,
        "type": kind,
        "asset": asset,
        "sector": "cash" if asset == "cash" else "broad_market",
        "value": value,
    }


COMPLETE_HOLDINGS = [
    _holding("VTI", "us_equity", 7000),
    _holding("VXUS", "intl_equity", 1000),
    _holding("BND", "bonds", 1000),
    _holding("CASH", "cash", 500, "cash"),
    _holding("ALT", "alternatives", 500),
]

DEMO_HOLDINGS = [
    _holding("AAPL", "us_equity", 5000, "stock"),
    _holding("NVDA", "us_equity", 5500, "stock"),
    _holding("TSLA", "us_equity", 3500, "stock"),
    _holding("VOO", "us_equity", 7000),
    _holding("VXUS", "intl_equity", 1500),
    _holding("CASH", "cash", 2500, "cash"),
]


def _assert_accounting(body: dict) -> None:
    projected = sum(holding["value"] for holding in body["projectedHoldings"])
    assert (
        projected + body["cashRemaining"] + body["unresolvedAmount"]
        == pytest.approx(body["afterTotal"])
    )
    assert body["totalTraded"] == pytest.approx(
        body["totalBuys"] + body["totalSells"]
    )


def test_full_rebalance_is_exact_deterministic_and_reconciled(client):
    payload = {
        "profile": PROFILE,
        "holdings": COMPLETE_HOLDINGS,
        "mode": "rebalance",
        "contributionAmount": 1000,
        "minTradeAmount": 10,
    }
    first = client.post("/portfolio/rebalance", json=payload)
    second = client.post("/portfolio/rebalance", json=payload)

    assert first.status_code == 200
    assert first.json() == second.json()
    body = first.json()
    assert body["targetSource"] == "risk_profile"
    assert body["targetProfile"] == "growth"
    assert body["previewOnly"] is True
    assert body["exactTargetReached"] is True
    assert body["canApply"] is True
    assert body["cashRemaining"] == 0
    assert body["totalBuys"] - body["totalSells"] == pytest.approx(1000)
    assert body["afterAllocation"] == pytest.approx(body["targetAllocation"])
    assert all(trade["resolved"] for trade in body["trades"])
    _assert_accounting(body)


def test_explicit_target_does_not_invent_missing_buy_vehicle(client):
    response = client.post(
        "/portfolio/rebalance",
        json={
            "holdings": [_holding("VTI", "us_equity", 10000)],
            "targetAllocation": {"us_equity": 0.5, "bonds": 0.5},
            "mode": "rebalance",
        },
    )

    assert response.status_code == 200
    body = response.json()
    unresolved = [trade for trade in body["trades"] if not trade["resolved"]]
    assert unresolved == [
        {
            "symbol": None,
            "name": None,
            "asset": "bonds",
            "action": "buy",
            "amount": 5000.0,
            "beforeValue": None,
            "afterValue": None,
            "resolved": False,
        }
    ]
    assert body["targetSource"] == "custom"
    assert body["totalSells"] == 5000
    assert body["totalBuys"] == 5000
    assert body["unresolvedAmount"] == 5000
    assert body["cashRemaining"] == 0
    assert body["exactTargetReached"] is True
    assert body["canApply"] is False
    assert "unresolved_buy_target" in {item["code"] for item in body["warnings"]}
    _assert_accounting(body)


def test_new_money_only_never_sells_and_reports_infeasibility(client):
    response = client.post(
        "/portfolio/rebalance",
        json={
            "profile": PROFILE,
            "holdings": COMPLETE_HOLDINGS,
            "mode": "new_money_only",
            "contributionAmount": 1000,
            "minTradeAmount": 10,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["totalSells"] == 0
    assert all(trade["action"] == "buy" for trade in body["trades"])
    assert body["totalBuys"] == 1000
    assert body["exactTargetReached"] is False
    assert body["canApply"] is True
    assert "new_money_insufficient" in {item["code"] for item in body["warnings"]}
    _assert_accounting(body)


def test_new_money_is_distributed_proportionally_across_target_deficits(client):
    demo_profile = {
        "age": 28,
        "income": 90000,
        "contribution": 750,
        "horizon": 30,
        "risk": 4,
        "emergency": 4,
        "goal": "long_term_growth",
        "liquidity": "medium",
    }
    response = client.post(
        "/portfolio/rebalance",
        json={
            "profile": demo_profile,
            "holdings": DEMO_HOLDINGS,
            "mode": "new_money_only",
            "contributionAmount": 750,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert [(trade["asset"], trade["amount"]) for trade in body["trades"]] == [
        ("intl_equity", 461.30),
        ("bonds", 240.58),
        ("alternatives", 48.12),
    ]
    assert body["totalBuys"] == 750
    assert body["cashRemaining"] == 0
    assert body["unresolvedAmount"] == 288.70
    assert body["canApply"] is False
    _assert_accounting(body)


def test_demo_full_rebalance_matches_the_documented_dollar_plan(client):
    response = client.post(
        "/portfolio/rebalance",
        json={
            "holdings": DEMO_HOLDINGS,
            "targetProfile": "growth",
            "mode": "rebalance",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert [
        (trade["action"], trade["asset"], trade["amount"])
        for trade in body["trades"]
    ] == [
        ("sell", "us_equity", 6000.0),
        ("sell", "cash", 1750.0),
        ("buy", "intl_equity", 4750.0),
        ("buy", "bonds", 2500.0),
        ("buy", "alternatives", 500.0),
    ]
    assert body["afterAllocation"] == pytest.approx(body["targetAllocation"])
    assert body["exactTargetReached"] is True
    assert body["canApply"] is False
    assert body["unresolvedAmount"] == 3000
    _assert_accounting(body)


def test_new_money_only_can_reach_an_explicit_target_exactly(client):
    response = client.post(
        "/portfolio/rebalance",
        json={
            "holdings": [
                _holding("VTI", "us_equity", 700),
                _holding("BND", "bonds", 300),
            ],
            "targetAllocation": {"us_equity": 0.6, "bonds": 0.4},
            "mode": "new_money_only",
            "contributionAmount": 166.67,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["trades"] == [
        {
            "symbol": "BND",
            "name": "BND",
            "asset": "bonds",
            "action": "buy",
            "amount": 166.67,
            "beforeValue": 300.0,
            "afterValue": 466.67,
            "resolved": True,
        }
    ]
    assert body["exactTargetReached"] is True
    assert body["warnings"] == []
    assert body["canApply"] is True
    _assert_accounting(body)


def test_minimum_trade_skips_small_asset_class_drifts(client):
    response = client.post(
        "/portfolio/rebalance",
        json={
            "holdings": [
                _holding("VTI", "us_equity", 510),
                _holding("BND", "bonds", 490),
            ],
            "targetProfile": "balanced",
            "mode": "rebalance",
            "minTradeAmount": 100,
        },
    )

    assert response.status_code == 200
    body = response.json()
    # Balanced also introduces missing asset classes; every drift under $100
    # is suppressed before holding-level routing.
    assert all(trade["amount"] >= 100 for trade in body["trades"])
    assert "below_minimum_trade" in {item["code"] for item in body["warnings"]}
    assert body["exactTargetReached"] is False
    _assert_accounting(body)


def test_leftover_contribution_is_kept_in_an_existing_cash_holding(client):
    response = client.post(
        "/portfolio/rebalance",
        json={
            "holdings": [
                _holding("VTI", "us_equity", 500),
                _holding("CASH", "cash", 500, "cash"),
            ],
            "targetAllocation": {"us_equity": 0.5, "cash": 0.5},
            "mode": "new_money_only",
            "contributionAmount": 10,
            "minTradeAmount": 100,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["cashRemaining"] == 0
    assert body["unresolvedAmount"] == 0
    assert body["projectedHoldings"][1]["value"] == 510
    assert body["trades"][-1]["symbol"] == "CASH"
    assert body["trades"][-1]["amount"] == 10
    assert body["canApply"] is True
    _assert_accounting(body)


@pytest.mark.parametrize(
    "payload",
    [
        {"holdings": [], "targetAllocation": {"us_equity": 0.8}},
        {
            "holdings": [],
            "targetProfile": "balanced",
            "targetAllocation": {"us_equity": 1.0},
        },
        {"holdings": [], "targetProfile": "balanced", "previewOnly": False},
        {"holdings": []},
    ],
)
def test_invalid_or_non_preview_requests_are_rejected(client, payload):
    assert client.post("/portfolio/rebalance", json=payload).status_code == 422


def test_sell_routing_uses_largest_holding_first(client):
    response = client.post(
        "/portfolio/rebalance",
        json={
            "holdings": [
                _holding("SMALL", "us_equity", 200),
                _holding("LARGE", "us_equity", 800),
                _holding("BND", "bonds", 1000),
            ],
            "targetAllocation": {"us_equity": 0.25, "bonds": 0.75},
            "mode": "rebalance",
        },
    )

    assert response.status_code == 200
    sells = [trade for trade in response.json()["trades"] if trade["action"] == "sell"]
    assert sells == [
        {
            "symbol": "LARGE",
            "name": "LARGE",
            "asset": "us_equity",
            "action": "sell",
            "amount": 500.0,
            "beforeValue": 800.0,
            "afterValue": 300.0,
            "resolved": True,
        }
    ]
