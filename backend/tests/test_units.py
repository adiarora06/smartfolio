"""Unit tests for the pure pieces: URL normalizer and compliance rules."""
from __future__ import annotations

from app.config import _normalize_db_url
from app.marketdata.alphavantage import parse_articles
from app.services.ai.compliance import violations


def _news_payload():
    return {
        "feed": [
            {
                "title": "Apple unveils new chip",
                "source": "Reuters",
                "url": "https://example.com/1",
                "time_published": "20260723T140000",
                "summary": "  Apple   announced a new   processor. ",
                "overall_sentiment_label": "Somewhat-Bullish",
                "ticker_sentiment": [
                    {
                        "ticker": "AAPL",
                        "relevance_score": "0.85",
                        "ticker_sentiment_score": "0.33",
                        "ticker_sentiment_label": "Bullish",
                    }
                ],
            },
            {
                "title": "Market roundup mentions Apple briefly",
                "source": "CNBC",
                "url": "https://example.com/2",
                "time_published": "20260722T090000",
                "ticker_sentiment": [
                    {"ticker": "AAPL", "relevance_score": "0.10", "ticker_sentiment_score": "0.0"}
                ],
            },
            {
                "title": "Unrelated Tesla story",
                "time_published": "20260721T090000",
                "ticker_sentiment": [
                    {"ticker": "TSLA", "relevance_score": "0.9", "ticker_sentiment_score": "0.1"}
                ],
            },
        ]
    }


def test_parse_articles_ranks_by_relevance_and_excludes_other_tickers():
    articles = parse_articles("AAPL", _news_payload(), limit=3)
    titles = [a.title for a in articles]
    # Most relevant AAPL story first; the low-relevance one after; TSLA excluded.
    assert titles == [
        "Apple unveils new chip",
        "Market roundup mentions Apple briefly",
    ]


def test_parse_articles_normalizes_fields():
    top = parse_articles("AAPL", _news_payload(), limit=3)[0]
    assert top.source == "Reuters"
    assert top.published == "2026-07-23"  # AV's "20260723T..." -> ISO date
    assert top.summary == "Apple announced a new processor."  # whitespace collapsed
    assert top.sentiment_label == "Bullish"  # ticker-specific label wins
    assert top.sentiment_score == 0.33


def test_parse_articles_limit_and_empty_feed():
    assert parse_articles("AAPL", _news_payload(), limit=1) == parse_articles(
        "AAPL", _news_payload(), limit=1
    )
    assert len(parse_articles("AAPL", _news_payload(), limit=1)) == 1
    assert parse_articles("AAPL", {"feed": []}) == []
    assert parse_articles("AAPL", {}) == []


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
