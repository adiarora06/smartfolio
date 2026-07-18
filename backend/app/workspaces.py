"""Workspace persistence endpoints.

Anonymous-workspace model: the frontend mints a workspace once, keeps the id in
localStorage, and hydrates/saves state through these routes. No accounts, no
credentials — auth is a separate, later design decision.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import (
    HoldingRow,
    MemoRow,
    ProfileRow,
    StockRunRow,
    WorkspaceRow,
    get_session,
    new_id,
    workspace_exists,
)
from .schemas import (
    AnalysisSummary,
    Holding,
    HoldingsPut,
    InvestorProfile,
    MemoIn,
    MemoOut,
    WorkspaceCreateResponse,
    WorkspaceState,
)

router = APIRouter()


async def _require_workspace(session: AsyncSession, workspace_id: str) -> None:
    if not await workspace_exists(session, workspace_id):
        raise HTTPException(status_code=404, detail="workspace not found")


@router.post("/workspaces", response_model=WorkspaceCreateResponse)
async def create_workspace(
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
            symbol=h.symbol,
            name=h.name,
            type=h.type,  # type: ignore[arg-type]
            asset=h.asset,  # type: ignore[arg-type]
            sector=h.sector,
            value=h.value,
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

    return WorkspaceState(profile=profile, holdings=holdings, memos=memos)


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


@router.put("/workspaces/{workspace_id}/holdings")
async def put_holdings(
    workspace_id: str,
    body: HoldingsPut,
    session: AsyncSession = Depends(get_session),
) -> dict:
    await _require_workspace(session, workspace_id)
    await session.execute(delete(HoldingRow).where(HoldingRow.workspace_id == workspace_id))
    for i, h in enumerate(body.holdings):
        session.add(HoldingRow(workspace_id=workspace_id, position=i, **h.model_dump()))
    await session.commit()
    return {"ok": True, "count": len(body.holdings)}


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
    analysis_id: str, session: AsyncSession = Depends(get_session)
) -> dict:
    """The roadmap's GET /analyses/{id} — a full stored run, replayable."""
    row = await session.get(StockRunRow, analysis_id)
    if row is None:
        raise HTTPException(status_code=404, detail="analysis not found")
    return row.result
