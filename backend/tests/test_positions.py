"""Enriched holding contracts, P&L coverage, quotes, and stable persistence."""
from __future__ import annotations

import asyncio

import app.plaid as plaid_module
from app.marketdata.base import MarketSnapshot
from app.marketdata.resolver import MarketDataResolver, ResolvedQuote, resolver


def _holding(symbol: str, value: float, **extra) -> dict:
    return {
        "symbol": symbol,
        "name": symbol or "Draft",
        "type": "stock",
        "asset": "us_equity",
        "sector": "technology",
        "value": value,
        **extra,
    }


def test_legacy_value_only_positions_remain_valid_and_truthful(client):
    response = client.post(
        "/portfolio/positions",
        json={
            "holdings": [
                _holding("aapl", 1000),
                {
                    "symbol": "CASH",
                    "name": "Cash",
                    "type": "cash",
                    "asset": "cash",
                    "sector": "cash",
                    "value": 500,
                },
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["holdings"][0]["symbol"] == "AAPL"
    assert body["holdings"][0]["value"] == 1000
    assert body["holdings"][0]["quantity"] is None
    assert body["positions"][0]["unrealizedGain"] is None
    assert body["positions"][0]["gainStatus"] == "unavailable"
    assert body["positions"][1]["costBasis"] == 500
    assert body["positions"][1]["unrealizedGain"] == 0
    assert body["positions"][1]["gainStatus"] == "complete"
    assert body["summary"]["marketValue"] == 1500
    assert body["summary"]["costBasisCoverage"] == 1 / 3
    assert body["summary"]["quantityCoverage"] == 0
    assert body["summary"]["calculationStatus"] == "partial"


def test_cost_basis_derivation_and_complete_gain(client):
    response = client.post(
        "/portfolio/positions",
        json={
            "holdings": [
                _holding(
                    "AAPL",
                    1000,
                    id="position-aapl",
                    quantity=10,
                    averageCost=90,
                    currentPrice=100,
                    priceAsOf="2026-09-08",
                    priceSource="manual",
                )
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    holding = body["holdings"][0]
    position = body["positions"][0]
    assert holding["costBasis"] == 900
    assert position["holdingId"] == "position-aapl"
    assert position["unrealizedGain"] == 100
    assert position["unrealizedGainPct"] == 1 / 9
    assert position["valuationMode"] == "quantity_priced"
    assert position["priceStatus"] == "manual"
    assert body["summary"]["costBasisCoverage"] == 1
    assert body["summary"]["quantityCoverage"] == 1
    assert body["summary"]["pricedCoverage"] == 1
    assert body["summary"]["calculationStatus"] == "complete"


def test_invalid_basis_and_price_dates_are_rejected(client):
    no_quantity = client.post(
        "/portfolio/positions",
        json={"holdings": [_holding("AAPL", 1000, averageCost=90)]},
    )
    assert no_quantity.status_code == 422

    mismatched = client.post(
        "/portfolio/positions",
        json={
            "holdings": [
                _holding("AAPL", 1000, quantity=10, averageCost=90, costBasis=400)
            ]
        },
    )
    assert mismatched.status_code == 422

    invalid_date = client.post(
        "/portfolio/positions",
        json={
            "holdings": [
                _holding(
                    "AAPL", 1000, currentPrice=100, priceAsOf="2026-02-30"
                )
            ]
        },
    )
    assert invalid_date.status_code == 422


def test_reference_quote_requires_opt_in_and_never_fabricates_quantity(
    client, monkeypatch
):
    async def reference_quote(symbol: str) -> ResolvedQuote:
        return ResolvedQuote(
            snapshot=MarketSnapshot(
                symbol=symbol, price=123.0, source="offline", as_of=None
            ),
            origin="reference",
        )

    monkeypatch.setattr(resolver, "resolve_quote", reference_quote)
    holding = _holding("AAPL", 300)

    guarded = client.post(
        "/portfolio/positions",
        json={"holdings": [holding], "refreshPrices": True},
    ).json()
    assert guarded["holdings"][0]["value"] == 300
    assert guarded["holdings"][0]["currentPrice"] is None
    assert {warning["code"] for warning in guarded["warnings"]} >= {
        "offline_reference_not_applied"
    }

    allowed = client.post(
        "/portfolio/positions",
        json={
            "holdings": [holding],
            "refreshPrices": True,
            "allowOfflineReferencePrices": True,
        },
    ).json()
    assert allowed["holdings"][0]["currentPrice"] == 123
    assert allowed["holdings"][0]["priceSource"] == "offline_reference"
    assert allowed["holdings"][0]["quantity"] is None
    assert allowed["holdings"][0]["value"] == 300
    assert allowed["positions"][0]["priceStatus"] == "reference"
    assert {warning["code"] for warning in allowed["warnings"]} >= {
        "offline_reference_applied",
        "quantity_unavailable",
    }


def test_live_refresh_revalues_only_known_quantity_and_normalizes_timestamp(
    client, monkeypatch
):
    calls: list[str] = []

    async def live_quote(symbol: str) -> ResolvedQuote:
        calls.append(symbol)
        return ResolvedQuote(
            snapshot=MarketSnapshot(
                symbol=symbol,
                price=125.25,
                source="finnhub",
                as_of="2026-09-08T15:30:00Z",
            ),
            origin="cache",
        )

    monkeypatch.setattr(resolver, "resolve_quote", live_quote)
    response = client.post(
        "/portfolio/positions",
        json={
            "holdings": [
                _holding("AAPL", 100, quantity=2),
                _holding("AAPL", 75, id="second-lot", quantity=1),
            ],
            "refreshPrices": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert calls == ["AAPL"]
    assert [holding["value"] for holding in body["holdings"]] == [250.5, 125.25]
    assert all(
        holding["priceAsOf"] == "2026-09-08" for holding in body["holdings"]
    )
    assert all(
        holding["priceSource"] == "finnhub" for holding in body["holdings"]
    )
    assert all(position["priceStatus"] == "cached" for position in body["positions"])


def test_demo_price_source_is_labeled_reference(client):
    body = client.post(
        "/portfolio/positions",
        json={
            "holdings": [
                _holding(
                    "AAPL",
                    215,
                    quantity=1,
                    currentPrice=215,
                    priceSource="demo",
                    source="demo",
                )
            ]
        },
    ).json()
    assert body["positions"][0]["priceStatus"] == "reference"


def test_workspace_assigns_and_preserves_ids_and_enriched_fields(client):
    workspace = client.post("/workspaces").json()["id"]
    first = client.put(
        f"/workspaces/{workspace}/holdings",
        json={"holdings": [_holding("AAPL", 1000)]},
    )
    assert first.status_code == 200
    holding_id = first.json()["holdings"][0]["id"]
    assert holding_id

    enriched = _holding(
        "AAPL",
        1100,
        id=holding_id,
        quantity=10,
        costBasis=900,
        currentPrice=110,
        priceAsOf="2026-09-08",
        priceSource="finnhub",
        source="imported",
    )
    second = client.put(
        f"/workspaces/{workspace}/holdings", json={"holdings": [enriched]}
    )
    assert second.status_code == 200
    assert second.json()["holdings"][0]["id"] == holding_id

    saved = client.get(f"/workspaces/{workspace}/state").json()["holdings"][0]
    assert saved["id"] == holding_id
    assert saved["quantity"] == 10
    assert saved["averageCost"] == 90
    assert saved["costBasis"] == 900
    assert saved["currentPrice"] == 110
    assert saved["priceAsOf"] == "2026-09-08"
    assert saved["priceSource"] == "finnhub"
    assert saved["source"] == "imported"

    # An id-less legacy save reuses the row identity at the same position.
    legacy = client.put(
        f"/workspaces/{workspace}/holdings",
        json={"holdings": [_holding("AAPL", 1200)]},
    ).json()
    assert legacy["holdings"][0]["id"] == holding_id


def test_workspace_rejects_duplicate_ids_and_isolates_same_id(client):
    workspace = client.post("/workspaces").json()["id"]
    other = client.post("/workspaces").json()["id"]
    stable_id = "x" * 64
    duplicate = client.put(
        f"/workspaces/{workspace}/holdings",
        json={
            "holdings": [
                _holding("AAPL", 100, id=stable_id),
                _holding("MSFT", 200, id=stable_id),
            ]
        },
    )
    assert duplicate.status_code == 422

    assert client.put(
        f"/workspaces/{workspace}/holdings",
        json={"holdings": [_holding("AAPL", 100, id=stable_id)]},
    ).status_code == 200
    assert client.put(
        f"/workspaces/{other}/holdings",
        json={"holdings": [_holding("AAPL", 999, id=stable_id)]},
    ).status_code == 200
    assert client.get(f"/workspaces/{workspace}/state").json()["holdings"][0][
        "value"
    ] == 100
    assert client.get(f"/workspaces/{other}/state").json()["holdings"][0][
        "value"
    ] == 999


def test_workspace_ids_survive_reorder_and_omitted_rows_are_deleted(client):
    workspace = client.post("/workspaces").json()["id"]
    initial = client.put(
        f"/workspaces/{workspace}/holdings",
        json={
            "holdings": [
                _holding("AAPL", 100, id="holding-aapl"),
                _holding("MSFT", 200, id="holding-msft"),
            ]
        },
    )
    assert initial.status_code == 200

    reordered = client.put(
        f"/workspaces/{workspace}/holdings",
        json={
            "holdings": [
                _holding("MSFT", 220, id="holding-msft"),
                _holding("AAPL", 110, id="holding-aapl"),
            ]
        },
    )
    assert [h["id"] for h in reordered.json()["holdings"]] == [
        "holding-msft",
        "holding-aapl",
    ]
    assert [h["id"] for h in client.get(
        f"/workspaces/{workspace}/state"
    ).json()["holdings"]] == ["holding-msft", "holding-aapl"]

    deleted = client.put(
        f"/workspaces/{workspace}/holdings",
        json={"holdings": [_holding("AAPL", 111, id="holding-aapl")]},
    )
    assert deleted.json()["count"] == 1
    state = client.get(f"/workspaces/{workspace}/state").json()
    assert [h["id"] for h in state["holdings"]] == ["holding-aapl"]


def test_transaction_holding_id_round_trips(client):
    workspace = client.post("/workspaces").json()["id"]
    response = client.put(
        f"/workspaces/{workspace}/transactions",
        json={
            "transactions": [
                {
                    "id": "trade-1",
                    "holdingId": "position-aapl",
                    "date": "2026-09-08",
                    "type": "buy",
                    "symbol": "AAPL",
                    "quantity": 1,
                    "price": 100,
                    "amount": 100,
                    "description": "Add one share",
                    "source": "manual",
                }
            ]
        },
    )
    assert response.status_code == 200
    transaction = client.get(f"/workspaces/{workspace}/state").json()[
        "transactions"
    ][0]
    assert transaction["holdingId"] == "position-aapl"


def test_rebalance_returns_holding_id_and_blocks_stale_share_metadata(client):
    response = client.post(
        "/portfolio/rebalance",
        json={
            "holdings": [
                _holding(
                    "VTI",
                    700,
                    id="position-vti",
                    quantity=7,
                    currentPrice=100,
                ),
                {
                    **_holding("BND", 300, id="position-bnd", quantity=3),
                    "type": "etf",
                    "asset": "bonds",
                    "sector": "broad_market",
                },
            ],
            "targetAllocation": {"us_equity": 0.6, "bonds": 0.4},
            "mode": "new_money_only",
            "contributionAmount": 166.67,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["trades"][0]["holdingId"] == "position-bnd"
    assert body["canApply"] is False
    assert "share_quantity_unadjusted" in {
        warning["code"] for warning in body["warnings"]
    }


def test_quote_only_resolver_never_calls_deep_analysis(monkeypatch):
    calls: list[str] = []

    class QuoteProvider:
        name = "test_quote"

        async def snapshot(self, client, symbol):
            calls.append(f"quote:{symbol}")
            return MarketSnapshot(
                symbol=symbol,
                price=42,
                source=self.name,
                as_of="2026-09-08",
            )

    class DeepProvider:
        name = "must_not_run"

        def __getattr__(self, name):
            raise AssertionError(f"deep provider method accessed: {name}")

    market = MarketDataResolver()
    market.provider = QuoteProvider()
    market.deep_provider = DeepProvider()

    async def uncached(symbol, function, fetch, context):
        calls.append(function)
        payload = await fetch()
        context.sources.append("quote:live")
        return payload

    monkeypatch.setattr(market, "_cached_fetch", uncached)

    async def run():
        try:
            return await market.resolve_quote("onlyquote")
        finally:
            await market.aclose()

    result = asyncio.run(run())
    assert result.snapshot.symbol == "ONLYQUOTE"
    assert result.snapshot.price == 42
    assert result.origin == "live"
    assert calls == ["quote", "quote:ONLYQUOTE"]


def test_plaid_maps_share_and_cost_metadata_with_stable_id(client, monkeypatch):
    monkeypatch.setattr(plaid_module.settings, "plaid_client_id", "client")
    monkeypatch.setattr(plaid_module.settings, "plaid_secret", "secret")
    requests: list[tuple[str, dict]] = []

    async def fake_plaid_post(path: str, body: dict) -> dict:
        requests.append((path, body))
        if path == "/item/public_token/exchange":
            return {"access_token": "access-once"}
        return {
            "accounts": [{"name": "Sandbox Investments"}],
            "securities": [
                {
                    "security_id": "security-aapl",
                    "ticker_symbol": "AAPL",
                    "name": "Apple Inc.",
                    "type": "equity",
                }
            ],
            "holdings": [
                {
                    "account_id": "account-1",
                    "security_id": "security-aapl",
                    "quantity": 2,
                    "institution_price": 125.25,
                    "institution_price_as_of": "2026-09-08T21:00:00Z",
                    "institution_value": 250.5,
                    "cost_basis": 180,
                }
            ],
        }

    monkeypatch.setattr(plaid_module, "_plaid_post", fake_plaid_post)
    first = client.post("/plaid/holdings", json={"publicToken": "public-token"})
    second = client.post("/plaid/holdings", json={"publicToken": "public-token"})

    assert first.status_code == 200
    assert second.status_code == 200
    holding = first.json()["holdings"][0]
    assert holding["id"] == second.json()["holdings"][0]["id"]
    assert len(holding["id"]) == 32
    assert holding["quantity"] == 2
    assert holding["currentPrice"] == 125.25
    assert holding["priceAsOf"] == "2026-09-08"
    assert holding["priceSource"] == "plaid"
    assert holding["costBasis"] == 180
    assert holding["averageCost"] == 90
    assert holding["source"] == "plaid"
    assert requests[1] == (
        "/investments/holdings/get",
        {"access_token": "access-once"},
    )


def test_positions_endpoint_is_rate_limited(client):
    headers = {"X-Forwarded-For": "198.51.100.77"}
    for _ in range(10):
        assert client.post(
            "/portfolio/positions",
            json={"holdings": []},
            headers=headers,
        ).status_code == 200
    assert client.post(
        "/portfolio/positions",
        json={"holdings": []},
        headers=headers,
    ).status_code == 429
