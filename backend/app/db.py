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

from sqlalchemy import (
    JSON,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    inspect,
    text,
)
from sqlalchemy.engine import Connection
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
    __table_args__ = (
        Index(
            "ux_holdings_workspace_holding_id",
            "workspace_id",
            "holding_id",
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    holding_id: Mapped[str] = mapped_column(String(64), default=new_id)
    symbol: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(128))
    type: Mapped[str] = mapped_column(String(16))
    asset: Mapped[str] = mapped_column(String(24))
    sector: Mapped[str] = mapped_column(String(48))
    value: Mapped[float] = mapped_column(Float)
    quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    average_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cost_basis: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    current_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_as_of: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    price_source: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    source: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    position: Mapped[int] = mapped_column(Integer)


class TransactionRow(Base):
    __tablename__ = "transactions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id"), primary_key=True, index=True
    )
    date: Mapped[str] = mapped_column(String(10), index=True)
    type: Mapped[str] = mapped_column(String(16))
    holding_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    symbol: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    amount: Mapped[float] = mapped_column(Float)
    description: Mapped[str] = mapped_column(String(160), default="")
    source: Mapped[str] = mapped_column(String(16), default="manual")
    created_at: Mapped[str] = mapped_column(String(32), default=_now)


class ValuationRow(Base):
    __tablename__ = "valuations"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id"), primary_key=True, index=True
    )
    date: Mapped[str] = mapped_column(String(10), index=True)
    value: Mapped[float] = mapped_column(Float)
    benchmark_symbol: Mapped[str] = mapped_column(String(16), default="VOO")
    benchmark_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="manual")
    created_at: Mapped[str] = mapped_column(String(32), default=_now)


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


class MarketCacheRow(Base):
    """Raw provider payloads, cached across restarts.

    Alpha Vantage's free tier allows ~25 requests/day, and a Render free-tier
    instance restarts whenever it idles out — an in-memory cache would burn the
    whole daily budget re-fetching the same tickers. Keyed by
    "SYMBOL:function"; the payload is stored verbatim so the parsers stay pure
    and a parser fix does not require a re-fetch.
    """

    __tablename__ = "market_cache"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    symbol: Mapped[str] = mapped_column(String(16), index=True)
    function: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSON)
    fetched_at: Mapped[str] = mapped_column(String(32), default=_now)
    expires_at: Mapped[str] = mapped_column(String(32), index=True)


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


_HOLDING_MIGRATION_COLUMNS = {
    "holding_id": "VARCHAR(64)",
    "quantity": "FLOAT",
    "average_cost": "FLOAT",
    "cost_basis": "FLOAT",
    "current_price": "FLOAT",
    "price_as_of": "VARCHAR(32)",
    "price_source": "VARCHAR(32)",
    "source": "VARCHAR(16)",
}


def migrate_enriched_holdings(conn: Connection) -> None:
    """Add enriched holding fields to an existing database without data loss.

    ``create_all`` creates the complete schema for new installations but does
    not alter existing tables. This small, idempotent migration keeps local
    SQLite databases and hosted Postgres databases upgradeable without adding
    a separate migration dependency.
    """

    inspector = inspect(conn)
    table_names = set(inspector.get_table_names())
    if "holdings" in table_names:
        holding_columns = {
            column["name"] for column in inspector.get_columns("holdings")
        }
        for name, sql_type in _HOLDING_MIGRATION_COLUMNS.items():
            if name not in holding_columns:
                conn.execute(text(f"ALTER TABLE holdings ADD COLUMN {name} {sql_type}"))

    if "transactions" in table_names:
        transaction_columns = {
            column["name"] for column in inspector.get_columns("transactions")
        }
        if "holding_id" not in transaction_columns:
            conn.execute(
                text("ALTER TABLE transactions ADD COLUMN holding_id VARCHAR(64)")
            )

    if "holdings" not in table_names:
        return

    # Repair missing IDs and the unlikely duplicate left by a partially applied
    # migration before creating the workspace-scoped uniqueness guarantee.
    rows = conn.execute(
        text(
            "SELECT id, workspace_id, holding_id FROM holdings "
            "ORDER BY workspace_id, id"
        )
    ).mappings()
    seen: set[tuple[str, str]] = set()
    for row in rows:
        workspace_id = str(row["workspace_id"])
        holding_id = str(row["holding_id"] or "").strip()
        if not holding_id or (workspace_id, holding_id) in seen:
            holding_id = new_id()
            while (workspace_id, holding_id) in seen:
                holding_id = new_id()
            conn.execute(
                text("UPDATE holdings SET holding_id = :holding_id WHERE id = :id"),
                {"holding_id": holding_id, "id": row["id"]},
            )
        seen.add((workspace_id, holding_id))

    conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_holdings_workspace_holding_id "
            "ON holdings (workspace_id, holding_id)"
        )
    )


async def init_db() -> None:
    # Ensure the SQLite directory exists before the first connection.
    url = settings.database_url
    if url.startswith("sqlite") and ":memory:" not in url:
        path = url.split("///", 1)[-1]
        Path(path).expanduser().parent.mkdir(parents=True, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(migrate_enriched_holdings)


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
