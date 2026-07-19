"""Rate limiting — protects the LLM/provider budget from abuse.

Only the endpoints that cost real money per call (LLM tokens, market-data
quota) are throttled; workspace CRUD stays unthrottled. In-memory storage is
correct for the current single-instance deploy; swap to Redis storage when
scaling horizontally (see SCALING_PLAN.md Phase 2).
"""
from __future__ import annotations

from fastapi import Request
from slowapi import Limiter


def client_ip(request: Request) -> str:
    """Real client IP behind Render/Vercel proxies (first X-Forwarded-For hop)."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=client_ip)

# Per-IP budgets for the endpoints that trigger LLM generations.
EXPENSIVE_LIMIT = "30/minute"
