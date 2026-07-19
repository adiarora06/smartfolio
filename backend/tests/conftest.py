"""Test bootstrap — isolate the DB before app import (config reads env at import)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Test DB lives beside the tests, never touches dev/prod data.
_TEST_DB = Path(__file__).parent / "test-data" / "test.db"
_TEST_DB.parent.mkdir(parents=True, exist_ok=True)
if _TEST_DB.exists():
    _TEST_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c
