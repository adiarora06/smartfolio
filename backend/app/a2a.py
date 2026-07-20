"""A2A agent card — SmartFolio as a discoverable agent.

Google's Agent2Agent (A2A) protocol lets agents discover each other via an
"agent card" served at /.well-known/agent.json: a machine-readable document
describing who the agent is, where to reach it, and what skills it offers.

This card is real and live: any A2A-aware client can discover SmartFolio's
analysis capabilities from it. The skills map 1:1 to actual REST endpoints
(a full A2A task/message runtime is the natural next step on top of this).
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["a2a"])


@router.get("/.well-known/agent.json", include_in_schema=False)
@router.get("/a2a/agent-card")
def agent_card() -> dict:
    return {
        "name": "SmartFolio Analyst",
        "description": (
            "Deterministic stock and portfolio analysis with an AI explanation "
            "layer. Every number is computed by deterministic code; the LLM only "
            "narrates, and a compliance agent validates all output as "
            "educational (never financial advice)."
        ),
        "url": "https://smartfolio-api-yjcj.onrender.com",
        "provider": {"organization": "SmartFolio"},
        "version": "0.7.0",
        "documentationUrl": "https://github.com/adiarora06/smartfolio",
        "capabilities": {"streaming": False, "pushNotifications": False},
        "defaultInputModes": ["application/json"],
        "defaultOutputModes": ["application/json"],
        "skills": [
            {
                "id": "analyze_stock",
                "name": "Analyze a stock",
                "description": (
                    "Full pipeline run for a ticker: live price resolution, "
                    "forecast bands, backtest, optional portfolio what-if, and a "
                    "compliance-checked memo. POST /stocks/analyze."
                ),
                "tags": ["stocks", "forecast", "backtest"],
                "examples": ["Analyze NVDA over a 45-day horizon."],
            },
            {
                "id": "analyze_portfolio",
                "name": "Diagnose a portfolio",
                "description": (
                    "Allocation vs risk target, concentration flags, and "
                    "structured recommendations. POST /portfolio/analyze."
                ),
                "tags": ["portfolio", "diversification", "risk"],
                "examples": ["Is this portfolio too concentrated in technology?"],
            },
            {
                "id": "ask_advisor",
                "name": "Ask the advisor",
                "description": (
                    "Natural-language Q&A grounded in a fresh deterministic "
                    "analysis of the provided state. POST /advisor/ask."
                ),
                "tags": ["advisor", "education"],
                "examples": ["What is my biggest diversification issue?"],
            },
        ],
    }
