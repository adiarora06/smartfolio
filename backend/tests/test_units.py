"""Unit tests for the pure pieces: URL normalizer and compliance rules."""
from __future__ import annotations

from app.config import _normalize_db_url
from app.services.ai.compliance import violations


def test_normalizer_neon_url():
    url = "postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require"
    assert _normalize_db_url(url) == "postgresql+asyncpg://u:p@ep-x.neon.tech/db"


def test_normalizer_heroku_style():
    assert _normalize_db_url("postgres://u:p@h/db").startswith("postgresql+asyncpg://")


def test_normalizer_leaves_sqlite_alone():
    url = "sqlite+aiosqlite:///./data/smartfolio.db"
    assert _normalize_db_url(url) == url


def test_compliance_rejects_advice_language():
    assert violations("You should buy this stock.")
    assert violations("This investment offers guaranteed returns.")
    assert violations("This is a risk-free opportunity — buy now!")


def test_compliance_allows_educational_framing():
    assert not violations(
        "Adding this position would raise your technology exposure to 40% of the portfolio."
    )
