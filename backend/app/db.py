"""Persistence layer — SQLAlchemy 2.0 async.

SQLite file by default (zero-setup local persistence); point DATABASE_URL at
Neon/Postgres for cloud deploys. Run payloads are stored as JSON — their shape
is already governed by the Pydantic contract; relational columns exist only
where we filter or sort.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Optional

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text, select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import settings
from .schemas import StockAnalyzeResponse


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


class WorkspaceRow(Base):
    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    created_at: Mapped[str] = mapped_column(String(32), default=_now)


class ProfileRow(Base):
    __tablename__ = "profiles"
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id"), primary_key=True
    )
    age: Mapped[float] = mapped_column(Float)
    income: Mapped[float] = mapped_column(Float)
    contribution: Mapped[float] = mapped_column(Float)
    horizon: Mapped[float] = mapped_column(Float)
    risk: Mapped[float] = mapped_column(Float)
    emergency: Mapped[float] = mapped_column(Float)
    goal: Mapped[str] = mapped_column(String(32))
    liquidity: Mapped[str] = mapped_column(String(16))
    updated_at: Mapped[str] = mapped_column(String(32), default=_now, onupdate=_now)


class HoldingRow(Base):
    __tablename__ = "holdings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(128))
    type: Mapped[str] = mapped_column(String(16))
    asset: Mapped[str] = mapped_column(String(24))
    sector: Mapped[str] = mapped_column(String(48))
    value: Mapped[float] = mapped_column(Float)
    position: Mapped[int] = mapped_column(Integer)


class StockRunRow(Base):
    __tablename__ = "stock_runs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(16))
    days: Mapped[float] = mapped_column(Float)
    rating: Mapped[str] = mapped_column(String(16))
    source: Mapped[str] = mapped_column(String(24))
    narrator: Mapped[str] = mapped_column(String(12))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String(32), default=_now)


class MemoRow(Base):
    __tablename__ = "memos"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(16))
    rating: Mapped[str] = mapped_column(String(16))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(32), default=_now)


# Neon (and most managed Postgres) require SSL; asyncpg takes it via connect_args,
# not the URL query string (which we strip in config._normalize_db_url).
# pool_pre_ping is essential with Neon: autosuspend kills idle connections, and
# without the ping the first request after a quiet period 500s on a dead socket.
if settings.is_postgres:
    engine = create_async_engine(
        settings.database_url,
        connect_args={"ssl": True},
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=5,
        max_overflow=5,
    )
else:
    engine = create_async_engine(settings.database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def init_db() -> None:
    # Ensure the SQLite directory exists before the first connection.
    url = settings.database_url
    if url.startswith("sqlite") and ":memory:" not in url:
        path = url.split("///", 1)[-1]
        Path(path).expanduser().parent.mkdir(parents=True, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def workspace_exists(session: AsyncSession, workspace_id: str) -> bool:
    row = await session.get(WorkspaceRow, workspace_id)
    return row is not None


async def save_stock_run(
    session: AsyncSession, workspace_id: str, resp: StockAnalyzeResponse
) -> Optional[str]:
    """Best-effort run persistence — never fails the analysis request."""
    try:
        if not await workspace_exists(session, workspace_id):
            return None
        run_id = new_id()
        session.add(
            StockRunRow(
                id=run_id,
                workspace_id=workspace_id,
                symbol=resp.forecast.symbol,
                days=resp.forecast.days,
                rating=resp.forecast.rating,
                source=resp.forecast.source,
                narrator=resp.narrator,
                result=resp.model_dump(by_alias=True, mode="json"),
            )
        )
        await session.commit()
        return run_id
    except Exception:
        await session.rollback()
        return None
