"""API surface tests — every route's happy path plus the failure contracts."""
from __future__ import annotations

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
    assert "analysis" in r.json()


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


def test_workspace_404(client):
    assert client.get("/workspaces/does-not-exist/state").status_code == 404
    assert client.get("/analyses/does-not-exist").status_code == 404


def test_analysis_persisted_via_header(client):
    ws = client.post("/workspaces").json()["id"]
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
    full = client.get(f"/analyses/{runs[0]['id']}").json()
    assert full["forecast"]["symbol"] == "NVDA"
