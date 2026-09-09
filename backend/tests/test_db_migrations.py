"""Database migration coverage for enriched portfolio holdings."""
from __future__ import annotations

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.db import Base, migrate_enriched_holdings


def _legacy_tables(conn) -> None:
    conn.execute(
        text(
            """CREATE TABLE holdings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_id VARCHAR(32) NOT NULL,
                symbol VARCHAR(16) NOT NULL,
                name VARCHAR(128) NOT NULL,
                type VARCHAR(16) NOT NULL,
                asset VARCHAR(24) NOT NULL,
                sector VARCHAR(48) NOT NULL,
                value FLOAT NOT NULL,
                position INTEGER NOT NULL
            )"""
        )
    )
    conn.execute(
        text(
            """CREATE TABLE transactions (
                id VARCHAR(64) NOT NULL,
                workspace_id VARCHAR(32) NOT NULL,
                date VARCHAR(10) NOT NULL,
                type VARCHAR(16) NOT NULL,
                symbol VARCHAR(16),
                quantity FLOAT,
                price FLOAT,
                amount FLOAT NOT NULL,
                description VARCHAR(160) NOT NULL,
                source VARCHAR(16) NOT NULL,
                created_at VARCHAR(32) NOT NULL,
                PRIMARY KEY (id, workspace_id)
            )"""
        )
    )


def test_enriched_holding_migration_is_non_destructive_and_idempotent():
    migration_engine = create_engine("sqlite:///:memory:")
    with migration_engine.begin() as conn:
        _legacy_tables(conn)
        conn.execute(
            text(
                """INSERT INTO holdings
                (workspace_id, symbol, name, type, asset, sector, value, position)
                VALUES
                ('workspace-a', 'AAPL', 'Apple', 'stock', 'us_equity', 'technology', 1200, 0),
                ('workspace-a', 'VOO', 'Vanguard S&P 500', 'etf', 'us_equity', 'broad_market', 800, 1)
                """
            )
        )

        # Match the real startup order: metadata creation first skips existing
        # tables, then the explicit additive migration upgrades them.
        Base.metadata.create_all(conn)
        migrate_enriched_holdings(conn)
        first_ids = conn.execute(
            text("SELECT holding_id FROM holdings ORDER BY position")
        ).scalars().all()
        migrate_enriched_holdings(conn)
        second_ids = conn.execute(
            text("SELECT holding_id FROM holdings ORDER BY position")
        ).scalars().all()

        assert first_ids == second_ids
        assert len(first_ids) == len(set(first_ids)) == 2
        assert all(len(holding_id) == 32 for holding_id in first_ids)
        assert conn.execute(text("SELECT COUNT(*) FROM holdings")).scalar_one() == 2

        schema = inspect(conn)
        holding_columns = {column["name"] for column in schema.get_columns("holdings")}
        assert {
            "holding_id",
            "quantity",
            "average_cost",
            "cost_basis",
            "current_price",
            "price_as_of",
            "price_source",
            "source",
        } <= holding_columns
        assert "holding_id" in {
            column["name"] for column in schema.get_columns("transactions")
        }
        assert any(
            index["name"] == "ux_holdings_workspace_holding_id" and index["unique"]
            for index in schema.get_indexes("holdings")
        )

        try:
            conn.execute(
                text(
                    """INSERT INTO holdings
                    (workspace_id, holding_id, symbol, name, type, asset, sector, value, position)
                    VALUES ('workspace-a', :holding_id, 'MSFT', 'Microsoft', 'stock',
                            'us_equity', 'technology', 500, 2)"""
                ),
                {"holding_id": first_ids[0]},
            )
        except IntegrityError:
            pass
        else:
            raise AssertionError("workspace and holding_id must remain unique")


def test_fresh_database_contains_enriched_holding_schema():
    fresh_engine = create_engine("sqlite:///:memory:")
    with fresh_engine.begin() as conn:
        Base.metadata.create_all(conn)
        migrate_enriched_holdings(conn)

        schema = inspect(conn)
        holding_columns = {
            column["name"]: column for column in schema.get_columns("holdings")
        }
        assert holding_columns["id"]["primary_key"] == 1
        assert holding_columns["holding_id"]["nullable"] is False
        assert "holding_id" in {
            column["name"] for column in schema.get_columns("transactions")
        }
