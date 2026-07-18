"""Compliance agent — enforcement, not fiction.

Validates AI-layer prose against SmartFolio's hard rules (no guarantees, no
buy/sell imperatives, educational framing) and appends the disclaimer to
LLM-generated output server-side. Deterministic templates are compliant by
construction and pass through untouched.
"""
from __future__ import annotations

import re
from typing import List

DISCLAIMER = "Educational analysis, not financial advice."

# Patterns that must never appear in user-facing narration.
_BANNED = [
    r"guarantee",
    r"can'?t\s+lose",
    r"risk[-\s]free",
    r"sure\s+thing",
    r"\bbuy\s+now\b",
    r"\bsell\s+now\b",
    r"\byou\s+should\s+(buy|sell)\b",
    r"will\s+(double|triple|soar|skyrocket)",
    r"certain\s+(gain|profit|return)",
    r"promise[sd]?\s+(you|a|returns)",
]
_BANNED_RE = [re.compile(p, re.IGNORECASE) for p in _BANNED]


def violations(text: str) -> List[str]:
    """Return the banned patterns present in the text (empty = compliant)."""
    return [rx.pattern for rx in _BANNED_RE if rx.search(text)]


def with_disclaimer(text: str) -> str:
    """Append the disclaimer unless the text already carries it."""
    if DISCLAIMER.lower() in text.lower():
        return text
    return f"{text}\n\n{DISCLAIMER}"
