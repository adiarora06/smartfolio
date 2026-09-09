"""Plaid brokerage sync — real holdings import via Plaid's Investments API.

Works fully in Plaid's FREE sandbox (fake institutions, credentials
user_good / pass_good); the same code path serves development/production
keys. No SDK — Plaid's REST API is three JSON POSTs via httpx.

Privacy stance: the access token is used once to fetch holdings and is
NEVER persisted. Each sync is a fresh Link session; SmartFolio stores only
the mapped holdings the user explicitly imports.
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request

from .config import settings
from .ratelimit import limiter
from .schemas import ApiModel, Holding

router = APIRouter(prefix="/plaid", tags=["plaid"])

_HOSTS = {
    "sandbox": "https://sandbox.plaid.com",
    "development": "https://development.plaid.com",
    "production": "https://production.plaid.com",
}


def _date_only(value: object) -> Optional[str]:
    if not value:
        return None
    candidate = str(value)[:10]
    try:
        date.fromisoformat(candidate)
    except ValueError:
        return None
    return candidate


def _host() -> str:
    return _HOSTS.get(settings.plaid_env, _HOSTS["sandbox"])


def _require_configured() -> None:
    if not settings.plaid_enabled:
        raise HTTPException(
            status_code=503,
            detail="Plaid is not configured — set PLAID_CLIENT_ID and PLAID_SECRET.",
        )


async def _plaid_post(path: str, body: dict) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{_host()}{path}",
            json={
                "client_id": settings.plaid_client_id,
                "secret": settings.plaid_secret,
                **body,
            },
        )
    data = resp.json()
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Plaid error: {data.get('error_code', resp.status_code)}",
        )
    return data


class LinkTokenResponse(ApiModel):
    link_token: str


class HoldingsImportRequest(ApiModel):
    public_token: str


class HoldingsImportResponse(ApiModel):
    institution: Optional[str] = None
    holdings: List[Holding]


# Plaid security.type -> SmartFolio asset class.
_ASSET_BY_TYPE = {
    "equity": "us_equity",
    "etf": "us_equity",
    "mutual fund": "us_equity",
    "fixed income": "bonds",
    "cash": "cash",
    "cryptocurrency": "crypto",
    "derivative": "alternatives",
    "loan": "other",
}


@router.post("/link-token", response_model=LinkTokenResponse)
@limiter.limit("10/minute")
async def create_link_token(request: Request) -> LinkTokenResponse:
    """Mint a Link token — the browser uses it to open Plaid Link."""
    _require_configured()
    data = await _plaid_post(
        "/link/token/create",
        {
            "user": {"client_user_id": "smartfolio-demo"},
            "client_name": "SmartFolio",
            "products": ["investments"],
            "country_codes": ["US"],
            "language": "en",
        },
    )
    return LinkTokenResponse(link_token=data["link_token"])


@router.post("/holdings", response_model=HoldingsImportResponse)
@limiter.limit("10/minute")
async def import_holdings(request: Request, body: HoldingsImportRequest) -> HoldingsImportResponse:
    """Exchange the public token and return mapped holdings (token not stored)."""
    _require_configured()
    exchange = await _plaid_post(
        "/item/public_token/exchange", {"public_token": body.public_token}
    )
    data = await _plaid_post(
        "/investments/holdings/get", {"access_token": exchange["access_token"]}
    )

    securities = {s["security_id"]: s for s in data.get("securities", [])}
    holdings: List[Holding] = []
    for h in data.get("holdings", []):
        sec = securities.get(h.get("security_id"), {})
        sec_type = (sec.get("type") or "equity").lower()
        value = h.get("institution_value")
        if value is None:
            value = (h.get("quantity") or 0) * (h.get("institution_price") or 0)
        raw_quantity = h.get("quantity")
        quantity = float(raw_quantity) if raw_quantity is not None else None
        raw_price = h.get("institution_price")
        current_price = (
            float(raw_price) if raw_price is not None and float(raw_price) > 0 else None
        )
        raw_basis = h.get("cost_basis")
        cost_basis = float(raw_basis) if raw_basis is not None else None
        average_cost = (
            cost_basis / quantity
            if cost_basis is not None and quantity is not None and quantity > 0
            else None
        )
        stable_key = f"{h.get('account_id', '')}:{h.get('security_id', '')}"
        symbol = (sec.get("ticker_symbol") or sec.get("name") or "?")[:16]
        holdings.append(
            Holding(
                id=uuid.uuid5(
                    uuid.NAMESPACE_URL, f"smartfolio:plaid:{stable_key}"
                ).hex,
                symbol=symbol.upper(),
                name=(sec.get("name") or symbol)[:128],
                type="cash" if sec_type == "cash" else ("etf" if sec_type == "etf" else "stock"),
                asset=_ASSET_BY_TYPE.get(sec_type, "other"),  # type: ignore[arg-type]
                sector="imported",
                value=round(float(value), 2),
                quantity=quantity,
                average_cost=average_cost,
                cost_basis=cost_basis,
                current_price=current_price,
                price_as_of=_date_only(h.get("institution_price_as_of")),
                price_source="plaid" if current_price is not None else None,
                source="plaid",
            )
        )

    institution = None
    accounts = data.get("accounts", [])
    if accounts:
        institution = accounts[0].get("name")
    return HoldingsImportResponse(institution=institution, holdings=holdings)
