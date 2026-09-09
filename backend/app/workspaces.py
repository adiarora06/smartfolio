"""Workspace persistence endpoints.

Anonymous-workspace model: the frontend mints a workspace once, keeps the id in
localStorage, and hydrates/saves state through these routes. No accounts, no
credentials — auth is a separate, later design decision.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .ratelimit import limiter

from .db import (
    HoldingRow,
    MemoRow,
    ProfileRow,
    StockRunRow,
    TransactionRow,
    ValuationRow,
    WorkspaceRow,
    get_session,
    new_id,
    workspace_exists,
)
from .schemas import (
    AnalysisSummary,
    Holding,
    HoldingsPut,
    HoldingsPutResponse,
    InvestorProfile,
    MemoIn,
    MemoOut,
    PortfolioTransaction,
    TransactionsPut,
    ValuationSnapshot,
    ValuationsPut,
    WorkspaceCreateResponse,
    WorkspaceState,
)

router = APIRouter()


async def _require_workspace(session: AsyncSession, workspace_id: str) -> None:
    if not await workspace_exists(session, workspace_id):
        raise HTTPException(status_code=404, detail="workspace not found")


@router.post("/workspaces", response_model=WorkspaceCreateResponse)
@limiter.limit("10/minute")  # each call writes a row — keep spam out
async def create_workspace(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> WorkspaceCreateResponse:
    workspace_id = new_id()
    session.add(WorkspaceRow(id=workspace_id))
    await session.commit()
    return WorkspaceCreateResponse(id=workspace_id)


@router.get("/workspaces/{workspace_id}/state", response_model=WorkspaceState)
async def get_state(
    workspace_id: str, session: AsyncSession = Depends(get_session)
) -> WorkspaceState:
    await _require_workspace(session, workspace_id)

    profile_row = await session.get(ProfileRow, workspace_id)
    profile: Optional[InvestorProfile] = None
    if profile_row is not None:
        profile = InvestorProfile(
            age=profile_row.age,
            income=profile_row.income,
            contribution=profile_row.contribution,
            horizon=profile_row.horizon,
            risk=profile_row.risk,
            emergency=profile_row.emergency,
            goal=profile_row.goal,  # type: ignore[arg-type]
            liquidity=profile_row.liquidity,  # type: ignore[arg-type]
        )

    holding_rows = (
        await session.scalars(
            select(HoldingRow)
            .where(HoldingRow.workspace_id == workspace_id)
            .order_by(HoldingRow.position)
        )
    ).all()
    holdings = [
        Holding(
            id=h.holding_id,
            symbol=h.symbol,
            name=h.name,
            type=h.type,  # type: ignore[arg-type]
            asset=h.asset,  # type: ignore[arg-type]
            sector=h.sector,
            value=h.value,
            quantity=h.quantity,
            average_cost=h.average_cost,
            cost_basis=h.cost_basis,
            current_price=h.current_price,
            price_as_of=h.price_as_of,
            price_source=h.price_source,
            source=h.source or "manual",  # type: ignore[arg-type]
        )
        for h in holding_rows
    ]

    memo_rows = (
        await session.scalars(
            select(MemoRow)
            .where(MemoRow.workspace_id == workspace_id)
            .order_by(MemoRow.created_at.desc())
            .limit(50)
        )
    ).all()
    memos = [
        MemoOut(
            id=m.id, symbol=m.symbol, rating=m.rating, body=m.body, created_at=m.created_at
        )
        for m in memo_rows
    ]

    transaction_rows = (
        await session.scalars(
            select(TransactionRow)
            .where(TransactionRow.workspace_id == workspace_id)
            .order_by(TransactionRow.date.desc(), TransactionRow.created_at.desc())
        )
    ).all()
    transactions = [
        PortfolioTransaction(
            id=row.id,
            date=row.date,
            type=row.type,  # type: ignore[arg-type]
            holding_id=row.holding_id,
            symbol=row.symbol,
            quantity=row.quantity,
            price=row.price,
            amount=row.amount,
            description=row.description,
            source=row.source,  # type: ignore[arg-type]
        )
        for row in transaction_rows
    ]

    valuation_rows = (
        await session.scalars(
            select(ValuationRow)
            .where(ValuationRow.workspace_id == workspace_id)
            .order_by(ValuationRow.date)
        )
    ).all()
    valuations = [
        ValuationSnapshot(
            id=row.id,
            date=row.date,
            value=row.value,
            benchmark_symbol=row.benchmark_symbol,
            benchmark_value=row.benchmark_value,
            source=row.source,  # type: ignore[arg-type]
        )
        for row in valuation_rows
    ]

    return WorkspaceState(
        profile=profile,
        holdings=holdings,
        memos=memos,
        transactions=transactions,
        valuations=valuations,
    )


@router.put("/workspaces/{workspace_id}/profile")
async def put_profile(
    workspace_id: str,
    profile: InvestorProfile,
    session: AsyncSession = Depends(get_session),
) -> dict:
    await _require_workspace(session, workspace_id)
    row = await session.get(ProfileRow, workspace_id)
    if row is None:
        row = ProfileRow(workspace_id=workspace_id, **profile.model_dump())
        session.add(row)
    else:
        for field, value in profile.model_dump().items():
            setattr(row, field, value)
    await session.commit()
    return {"ok": True}


@router.put(
    "/workspaces/{workspace_id}/holdings", response_model=HoldingsPutResponse
)
async def put_holdings(
    workspace_id: str,
    body: HoldingsPut,
    session: AsyncSession = Depends(get_session),
) -> HoldingsPutResponse:
    await _require_workspace(session, workspace_id)
    existing = list(
        (
            await session.scalars(
                select(HoldingRow)
                .where(HoldingRow.workspace_id == workspace_id)
                .order_by(HoldingRow.position)
            )
        ).all()
    )
    by_holding_id = {row.holding_id: row for row in existing if row.holding_id}
    requested_ids = [holding.id for holding in body.holdings if holding.id]
    if len(requested_ids) != len(set(requested_ids)):
        raise HTTPException(status_code=422, detail="holding ids must be unique")

    claimed_rows: set[int] = set()
    canonical: List[Holding] = []
    for i, h in enumerate(body.holdings):
        row = by_holding_id.get(h.id) if h.id else None
        # Legacy clients do not know holding ids. Reusing the row at the same
        # position avoids needless identity churn until they next hydrate and
        # adopt the canonical ids returned below.
        if row is None and h.id is None and i < len(existing):
            candidate = existing[i]
            if candidate.id not in claimed_rows:
                row = candidate
        holding_id = h.id or (row.holding_id if row is not None else new_id())
        if row is None:
            row = HoldingRow(workspace_id=workspace_id, holding_id=holding_id)
            session.add(row)
        claimed_rows.add(row.id) if row.id is not None else None

        row.holding_id = holding_id
        row.position = i
        for field, value in h.model_dump(exclude={"id"}).items():
            setattr(row, field, value)
        canonical.append(h.model_copy(update={"id": holding_id}))

    canonical_ids = {holding.id for holding in canonical}
    for row in existing:
        if row.holding_id not in canonical_ids:
            await session.delete(row)
    await session.commit()
    return HoldingsPutResponse(count=len(canonical), holdings=canonical)


@router.put("/workspaces/{workspace_id}/transactions")
async def put_transactions(
    workspace_id: str,
    body: TransactionsPut,
    session: AsyncSession = Depends(get_session),
) -> dict:
    await _require_workspace(session, workspace_id)
    await session.execute(
        delete(TransactionRow).where(TransactionRow.workspace_id == workspace_id)
    )
    for transaction in body.transactions:
        session.add(
            TransactionRow(
                workspace_id=workspace_id,
                **transaction.model_dump(),
            )
        )
    await session.commit()
    return {"ok": True, "count": len(body.transactions)}


@router.put("/workspaces/{workspace_id}/valuations")
async def put_valuations(
    workspace_id: str,
    body: ValuationsPut,
    session: AsyncSession = Depends(get_session),
) -> dict:
    await _require_workspace(session, workspace_id)
    await session.execute(
        delete(ValuationRow).where(ValuationRow.workspace_id == workspace_id)
    )
    for valuation in body.valuations:
        session.add(
            ValuationRow(
                workspace_id=workspace_id,
                **valuation.model_dump(),
            )
        )
    await session.commit()
    return {"ok": True, "count": len(body.valuations)}


@router.post("/workspaces/{workspace_id}/memos", response_model=MemoOut)
async def post_memo(
    workspace_id: str, memo: MemoIn, session: AsyncSession = Depends(get_session)
) -> MemoOut:
    await _require_workspace(session, workspace_id)
    row = MemoRow(id=new_id(), workspace_id=workspace_id, **memo.model_dump())
    session.add(row)
    await session.commit()
    return MemoOut(
        id=row.id, symbol=row.symbol, rating=row.rating, body=row.body, created_at=row.created_at
    )


@router.get("/workspaces/{workspace_id}/analyses", response_model=List[AnalysisSummary])
async def list_analyses(
    workspace_id: str,
    limit: int = 20,
    session: AsyncSession = Depends(get_session),
) -> List[AnalysisSummary]:
    await _require_workspace(session, workspace_id)
    rows = (
        await session.scalars(
            select(StockRunRow)
            .where(StockRunRow.workspace_id == workspace_id)
            .order_by(StockRunRow.created_at.desc())
            .limit(max(1, min(100, limit)))
        )
    ).all()
    return [
        AnalysisSummary(
            id=r.id,
            symbol=r.symbol,
            days=r.days,
            rating=r.rating,
            source=r.source,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.get("/analyses/{analysis_id}")
async def get_analysis(
    analysis_id: str,
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Replay a stored run only inside the requesting anonymous workspace."""
    if not x_workspace_id:
        raise HTTPException(status_code=401, detail="workspace header required")

    row = await session.scalar(
        select(StockRunRow).where(
            StockRunRow.id == analysis_id,
            StockRunRow.workspace_id == x_workspace_id,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="analysis not found")
    return row.result
