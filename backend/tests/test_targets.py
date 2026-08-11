"""Contract tests for target allocations shared with the web client."""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.services.data import TARGETS


def _frontend_targets() -> dict[str, dict[str, float]]:
    """Read the small TypeScript target literal so the mirrors cannot drift."""
    constants_path = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "lib"
        / "data"
        / "constants.ts"
    )
    source = constants_path.read_text(encoding="utf-8")
    match = re.search(
        r"export const TARGETS:[^=]+\=\s*\{(?P<body>.*?)\n\}",
        source,
        re.DOTALL,
    )
    assert match is not None, "Could not locate the frontend TARGETS literal"

    profiles: dict[str, dict[str, float]] = {}
    for profile, allocation_source in re.findall(
        r"^\s*(\w+):\s*\{([^}]+)\}",
        match.group("body"),
        re.MULTILINE,
    ):
        profiles[profile] = {
            asset: float(weight)
            for asset, weight in re.findall(
                r"(\w+):\s*(\d+(?:\.\d+)?)",
                allocation_source,
            )
        }
    return profiles


@pytest.mark.parametrize(("profile", "allocation"), TARGETS.items())
def test_target_allocation_sums_to_one(profile: str, allocation: dict[str, float]):
    assert sum(allocation.values()) == pytest.approx(1.0), profile


def test_frontend_and_backend_targets_match():
    assert _frontend_targets() == TARGETS
