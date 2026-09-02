"""API surface tests — every route's happy path plus the failure contracts."""
from __future__ import annotations

import pytest

PROFILE = {
    "age": 30,
    "income": 90000,
    "contribution": 1000,
    "horizon": 20,
    "risk": 6,
    "emergency": 6,
    "goal": "long_term_growth",
    "liquidity": "medium",
}
HOLDINGS = [
    {"symbol": "AAPL", "name": "Apple", "type": "stock", "asset": "us_equity", "sector": "technology", "value": 12000},
    {"symbol": "VTI", "name": "Vanguard Total Market", "type": "etf", "asset": "us_equity", "sector": "broad_market", "value": 20000},
]


def test_web_origin_still_allowed(client):
    r = client.get("/health", headers={"Origin": "https://smartfolio-lemon.vercel.app"})
    assert r.status_code == 200
    assert (
        r.headers.get("access-control-allow-origin")
        == "https://smartfolio-lemon.vercel.app"
    )


def test_root(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["service"] == "smartfolio-api"


def test_health_shape(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    for key in ("version", "liveMarketData", "llm", "database"):
        assert key in body


def test_request_id_header(client):
    r = client.get("/")
    assert r.headers.get("x-request-id")
    # Caller-provided ids are echoed back (trace continuity).
    r = client.get("/", headers={"X-Request-Id": "trace-123"})
    assert r.headers["x-request-id"] == "trace-123"


def test_stock_analyze_minimal(client):
    r = client.post("/stocks/analyze", json={"ticker": "AAPL", "days": 30})
    assert r.status_code == 200
    body = r.json()
    assert body["forecast"]["symbol"] == "AAPL"
    assert body["narrator"] in ("llm", "template")
    agents = [e["agent"] for e in body["events"]]
    assert "Compliance Agent" in agents
    # No holdings sent -> impact skipped.
    assert body["impact"] is None


def test_stock_analyze_with_portfolio(client):
    r = client.post(
        "/stocks/analyze",
        json={"ticker": "MSFT", "days": 60, "profile": PROFILE, "holdings": HOLDINGS},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["impact"] is not None
    assert 0 < body["impact"]["newWeight"] < 1


def test_stock_analyze_clamps_horizon(client):
    r = client.post("/stocks/analyze", json={"ticker": "aapl", "days": 9999})
    assert r.status_code == 200
    assert r.json()["forecast"]["days"] == 365


def test_portfolio_analyze(client):
    r = client.post("/portfolio/analyze", json={"profile": PROFILE, "holdings": HOLDINGS})
    assert r.status_code == 200
    analysis = r.json()["analysis"]
    assert analysis["risk"]["annualizedVolatility"] > 0
    assert analysis["risk"]["cvar95OneMonth"] > analysis["risk"]["var95OneMonth"]
    assert len(analysis["risk"]["stressTests"]) == 3


def test_scenario_lab_returns_seeded_comparisons_and_optimizer(client):
    payload = {
        "profile": PROFILE,
        "holdings": HOLDINGS,
        "primary": {
            "id": "current",
            "contribution": 1000,
            "returnAdj": 0,
            "rebalance": 0.5,
        },
        "strategies": [
            {
                "id": "baseline",
                "contribution": 750,
                "returnAdj": 0,
                "rebalance": 0.5,
            },
            {
                "id": "accelerate",
                "contribution": 1500,
                "returnAdj": 0.02,
                "rebalance": 0.65,
            },
        ],
        "goalValue": 300000,
        "targetProbability": 0.75,
        "horizonYears": 10,
        "simulationPaths": 300,
        "optimizationPaths": 300,
        "seed": 20260806,
        "maxContribution": 5000,
        "contributionStep": 50,
    }
    first = client.post("/portfolio/scenario-lab", json=payload)
    second = client.post("/portfolio/scenario-lab", json=payload)

    assert first.status_code == 200
    assert first.json() == second.json()
    simulation = first.json()["simulation"]
    assert len(simulation["points"]) == 11
    assert 0 <= simulation["successProbability"] <= 1
    assert simulation["terminal"]["p10"] <= simulation["terminal"]["p50"]
    assert simulation["terminal"]["p50"] <= simulation["terminal"]["p90"]
    assert simulation["assumptionDriven"] is True
    assert [item["id"] for item in first.json()["comparisons"]] == [
        "baseline",
        "accelerate",
    ]
    optimization = first.json()["optimization"]
    assert optimization["requiredContribution"] % 50 == 0
    assert optimization["achievedProbability"] >= 0.75 or optimization["capped"]


def test_advisor_receives_visible_scenario_context(client):
    stock = client.post("/stocks/analyze", json={"ticker": "AAPL", "days": 30}).json()[
        "forecast"
    ]
    r = client.post(
        "/advisor/ask",
        json={
            "question": "What is my chance of reaching the goal?",
            "profile": PROFILE,
            "holdings": HOLDINGS,
            "stock": stock,
            "scenario": {
                "contribution": 1000,
                "goalValue": 300000,
                "horizonYears": 10,
                "modeledReturn": 0.12,
                "modeledVolatility": 0.17,
                "successProbability": 0.61,
                "p10": 180000,
                "p50": 320000,
                "p90": 540000,
                "paths": 2000,
            },
        },
    )

    assert r.status_code == 200
    assert "61.0%" in r.json()["answer"]
    assert "$300,000" in r.json()["answer"]


def test_advisor_receives_visible_source_context(client):
    stock = client.post("/stocks/analyze", json={"ticker": "AAPL", "days": 30}).json()[
        "forecast"
    ]
    summary = "International Equity is 6.0% versus a 25.0% target."
    r = client.post(
        "/advisor/ask",
        json={
            "question": "How should I rebalance this gap?",
            "profile": PROFILE,
            "holdings": HOLDINGS,
            "stock": stock,
            "sourceContext": {
                "origin": "overview",
                "kind": "allocation_gap",
                "title": "International Equity allocation gap",
                "summary": summary,
                "suggestedQuestion": "How can I close this gap gradually?",
                "facts": {"Current": "6.0%", "Target": "25.0%"},
            },
        },
    )

    assert r.status_code == 200
    assert summary in r.json()["answer"]


def test_workspace_lifecycle(client):
    ws = client.post("/workspaces").json()["id"]

    r = client.put(f"/workspaces/{ws}/profile", json=PROFILE)
    assert r.status_code == 200
    r = client.put(f"/workspaces/{ws}/holdings", json={"holdings": HOLDINGS})
    assert r.json()["count"] == 2

    state = client.get(f"/workspaces/{ws}/state").json()
    assert state["profile"]["age"] == 30
    assert [h["symbol"] for h in state["holdings"]] == ["AAPL", "VTI"]

    memo = client.post(
        f"/workspaces/{ws}/memos",
        json={"symbol": "AAPL", "rating": "BUY-lean", "body": "test memo"},
    ).json()
    assert memo["id"]
    assert client.get(f"/workspaces/{ws}/state").json()["memos"][0]["symbol"] == "AAPL"

    transactions = [
        {
            "id": "deposit-1",
            "date": "2026-01-02",
            "type": "deposit",
            "amount": 1000,
            "description": "Initial funding",
            "source": "imported",
        }
    ]
    valuations = [
        {
            "id": "value-1",
            "date": "2026-01-02",
            "value": 1000,
            "benchmarkSymbol": "VOO",
            "benchmarkValue": 100,
            "source": "imported",
        },
        {
            "id": "value-2",
            "date": "2026-08-08",
            "value": 1100,
            "benchmarkSymbol": "VOO",
            "benchmarkValue": 106,
            "source": "imported",
        },
    ]
    assert client.put(
        f"/workspaces/{ws}/transactions", json={"transactions": transactions}
    ).json()["count"] == 1
    assert client.put(
        f"/workspaces/{ws}/valuations", json={"valuations": valuations}
    ).json()["count"] == 2
    state = client.get(f"/workspaces/{ws}/state").json()
    assert state["transactions"][0]["type"] == "deposit"
    assert state["valuations"][-1]["benchmarkValue"] == 106


def test_portfolio_performance_endpoint(client):
    r = client.post(
        "/portfolio/performance",
        json={
            "transactions": [
                {
                    "id": "deposit-1",
                    "date": "2026-01-02",
                    "type": "deposit",
                    "amount": 1000,
                    "description": "",
                    "source": "manual",
                }
            ],
            "valuations": [
                {
                    "id": "value-1",
                    "date": "2026-01-02",
                    "value": 1000,
                    "benchmarkSymbol": "VOO",
                    "benchmarkValue": 100,
                    "source": "manual",
                },
                {
                    "id": "value-2",
                    "date": "2026-08-08",
                    "value": 1120,
                    "benchmarkSymbol": "VOO",
                    "benchmarkValue": 108,
                    "source": "manual",
                },
            ],
        },
    )
    assert r.status_code == 200
    performance = r.json()["performance"]
    assert performance["measured"] is True
    assert performance["totalReturn"] == pytest.approx(0.12)
    assert performance["benchmarkReturn"] == pytest.approx(0.08)


def test_workspace_404(client):
    assert client.get("/workspaces/does-not-exist/state").status_code == 404
    assert client.get(
        "/analyses/does-not-exist",
        headers={"X-Workspace-Id": "does-not-exist"},
    ).status_code == 404


def test_oversized_holdings_rejected(client):
    """201 holdings breaches the 200 cap -> validation error, not a 500."""
    too_many = [dict(HOLDINGS[0]) for _ in range(201)]
    r = client.post(
        "/stocks/analyze",
        json={"ticker": "AAPL", "days": 30, "profile": PROFILE, "holdings": too_many},
    )
    assert r.status_code == 422


def test_oversized_question_rejected(client):
    r = client.post(
        "/advisor/ask",
        json={
            "question": "x" * 2001,
            "profile": PROFILE,
            "holdings": HOLDINGS,
            "stock": client.post(
                "/stocks/analyze", json={"ticker": "AAPL", "days": 30}
            ).json()["forecast"],
        },
    )
    assert r.status_code == 422


def test_a2a_agent_card(client):
    """The well-known A2A discovery document is live and well-formed."""
    for path in ("/.well-known/agent.json", "/a2a/agent-card"):
        r = client.get(path)
        assert r.status_code == 200
        card = r.json()
        assert card["name"] == "SmartFolio Analyst"
        assert {s["id"] for s in card["skills"]} == {
            "analyze_stock",
            "analyze_portfolio",
            "ask_advisor",
        }


def test_plaid_unconfigured_returns_503(client):
    """Without PLAID keys the endpoints refuse cleanly, not crash."""
    assert client.post("/plaid/link-token").status_code == 503
    r = client.post("/plaid/holdings", json={"publicToken": "public-sandbox-x"})
    assert r.status_code == 503


def test_analysis_persisted_via_header(client):
    ws = client.post("/workspaces").json()["id"]
    other_ws = client.post("/workspaces").json()["id"]
    r = client.post(
        "/stocks/analyze",
        json={"ticker": "NVDA", "days": 30},
        headers={"X-Workspace-Id": ws},
    )
    assert r.status_code == 200
    # Persistence is a background task; TestClient runs it before returning.
    runs = client.get(f"/workspaces/{ws}/analyses").json()
    assert len(runs) == 1
    assert runs[0]["symbol"] == "NVDA"
    analysis_url = f"/analyses/{runs[0]['id']}"
    full = client.get(
        analysis_url,
        headers={"X-Workspace-Id": ws},
    ).json()
    assert full["forecast"]["symbol"] == "NVDA"

    # A run is a workspace-owned resource. Missing or different workspace
    # context must never reveal its payload.
    assert client.get(analysis_url).status_code == 401
    assert client.get(
        analysis_url,
        headers={"X-Workspace-Id": other_ws},
    ).status_code == 404
