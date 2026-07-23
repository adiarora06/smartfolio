"""Tests for the distributional engine: the cone, the risk model, the backtest.

These target the properties that break silently. A cone whose quantiles cross,
a risk attribution that no longer sums to portfolio volatility, or a backtest
that peeks at future prices would all still return plausible-looking numbers.
"""
from __future__ import annotations

import datetime
import math

import pytest

from app.marketdata.base import MarketContext, MarketSnapshot
from app.marketdata.fundamentals import Fundamentals, quality_score
from app.marketdata.series import PriceSeries, compute_stats
from app.schemas import Holding, InvestorProfile
from app.services.backtest import walk_forward
from app.services.estimate import estimate_from_history, shrinkage_for
from app.services.impact import compute_impact
from app.services.quant import (
    MARKET_DRIFT,
    QUANTILES,
    cone,
    norm_cdf,
    norm_ppf,
    prob_drawdown,
    prob_gain,
    quantile_price,
    quantile_return,
)
from app.services.risk import (
    Position,
    decompose,
    marginal_contribution,
    max_weight_under_vol,
    positions_from_holdings,
    value_at_risk,
)
from app.services.stock import analyze_stock


# --- Synthetic history -----------------------------------------------------


def make_series(n=760, mu=0.10, sigma=0.28, start=100.0, seed=12345) -> PriceSeries:
    """Deterministic GBM path — an LCG so every run produces the same series."""
    state = seed

    def rnd() -> float:
        nonlocal state
        state = (1103515245 * state + 12345) % (2**31)
        return state / (2**31)

    def gauss() -> float:
        u1, u2 = max(rnd(), 1e-9), rnd()
        return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)

    price = start
    closes, dates = [], []
    day = datetime.date(2022, 1, 3)
    for _ in range(n):
        price *= math.exp(
            (mu - 0.5 * sigma**2) / 252 + sigma / math.sqrt(252) * gauss()
        )
        closes.append(round(price, 2))
        dates.append(day.isoformat())
        day += datetime.timedelta(days=1)
    return PriceSeries("TEST", dates, closes)


# --- Quantile math ---------------------------------------------------------


def test_norm_ppf_and_cdf_are_inverses():
    for q in (0.05, 0.25, 0.5, 0.75, 0.95):
        assert norm_cdf(norm_ppf(q)) == pytest.approx(q, abs=1e-6)


def test_known_z_scores():
    assert norm_ppf(0.25) == pytest.approx(-0.6744897501960817, abs=1e-9)
    assert norm_ppf(0.75) == pytest.approx(0.6744897501960817, abs=1e-9)
    assert norm_ppf(0.95) == pytest.approx(1.6448536269514722, abs=1e-9)


def test_quantiles_are_strictly_ordered():
    prices = [quantile_price(100, 0.08, 0.3, 0.25, q) for q in QUANTILES]
    assert prices == sorted(prices)
    assert len(set(prices)) == len(prices)


def test_cone_opens_from_a_point_and_widens_with_sqrt_t():
    points = cone(100.0, 0.08, 0.30, 1.0, steps=24)

    # Step 0 is today: no uncertainty yet, so every quantile is the spot price.
    first = points[0]
    assert first["q05"] == pytest.approx(100.0)
    assert first["q95"] == pytest.approx(100.0)

    # Width must increase monotonically...
    widths = [p["q95"] - p["q05"] for p in points]
    assert all(b >= a for a, b in zip(widths, widths[1:]))

    # ...and in log space it must scale as sqrt(t), not linearly. That is the
    # difference between a distribution and two scenario lines.
    quarter = points[6]
    full = points[24]
    log_width_q = math.log(quarter["q95"] / quarter["q05"])
    log_width_f = math.log(full["q95"] / full["q05"])
    assert log_width_f / log_width_q == pytest.approx(2.0, rel=0.01)


def test_interquartile_band_holds_half_the_mass():
    mu, sigma, t = 0.09, 0.32, 0.5
    lo = quantile_return(mu, sigma, t, 0.25)
    hi = quantile_return(mu, sigma, t, 0.75)
    # By construction P(return < hi) - P(return < lo) == 0.50.
    s0 = 100.0
    p_lo = norm_cdf(
        (math.log(s0 * (1 + lo) / s0) - (mu - sigma**2 / 2) * t) / (sigma * math.sqrt(t))
    )
    p_hi = norm_cdf(
        (math.log(s0 * (1 + hi) / s0) - (mu - sigma**2 / 2) * t) / (sigma * math.sqrt(t))
    )
    assert p_hi - p_lo == pytest.approx(0.50, abs=1e-6)


def test_prob_gain_tracks_the_median():
    """P(gain) > 0.5 exactly when the median return is positive."""
    for mu, sigma in ((0.20, 0.20), (0.02, 0.40), (-0.10, 0.25)):
        t = 0.5
        median = quantile_return(mu, sigma, t, 0.50)
        p = prob_gain(mu, sigma, t)
        assert (p > 0.5) == (median > 0)


def test_drawdown_probability_exceeds_terminal_probability():
    """A path can touch -20% and recover, so the first-passage probability must
    be strictly larger than the chance of *finishing* below -20%."""
    mu, sigma, t = 0.08, 0.35, 1.0
    touch = prob_drawdown(mu, sigma, t, 0.20)
    m, s = (mu - sigma**2 / 2) * t, sigma * math.sqrt(t)
    finish_below = norm_cdf((math.log(0.8) - m) / s)
    assert touch > finish_below
    assert 0.0 <= touch <= 1.0


def test_deeper_drawdowns_are_less_likely():
    mu, sigma, t = 0.07, 0.30, 0.5
    assert prob_drawdown(mu, sigma, t, 0.10) > prob_drawdown(mu, sigma, t, 0.20)
    assert prob_drawdown(mu, sigma, t, 0.20) > prob_drawdown(mu, sigma, t, 0.40)


# --- Estimation ------------------------------------------------------------


def test_single_crash_bar_cannot_define_the_volatility():
    """Regression: real IBM data contains a -25% session six trading days
    before the series end. Under EWMA(0.94) that one bar still carries ~0.69 of
    the newest bar's weight and drove the annualized estimate to 104% for a
    stock whose actual volatility is under 30%, producing a cone several times
    too wide. Winsorizing the returns keeps one observation from deciding the
    whole distribution."""
    series = make_series(n=400, sigma=0.22, seed=31337)
    calm = compute_stats(series)
    assert calm is not None

    # Splice a -25% session in near the end, where EWMA weighting is heaviest.
    shocked_closes = list(series.closes)
    for i in range(len(shocked_closes) - 6, len(shocked_closes)):
        shocked_closes[i] *= 0.75
    shocked = compute_stats(PriceSeries("X", series.dates, shocked_closes))
    assert shocked is not None

    # The shock must register — but not multiply the estimate several-fold.
    assert shocked.vol > calm.vol
    assert shocked.vol < calm.vol * 2.0, (
        f"one bar moved vol {calm.vol:.2f} -> {shocked.vol:.2f}"
    )


def test_winsorize_clips_without_reordering_or_dropping():
    from app.services.quant import winsorize

    returns = [0.01, -0.02, 0.005, 0.012] * 10
    returns[25] = -0.30  # one crash bar in forty ordinary sessions
    clipped = winsorize(returns)

    assert len(clipped) == len(returns)
    # Direction is preserved — the outlier is still the most negative value...
    assert clipped[25] == min(clipped)
    assert clipped[25] < 0
    # ...but it no longer carries its full, distribution-defining magnitude.
    assert clipped[25] > -0.30
    # Ordinary observations pass through untouched.
    assert clipped[0] == pytest.approx(0.01)
    assert clipped[1] == pytest.approx(-0.02)


def test_winsorize_leaves_a_genuinely_volatile_series_alone():
    """Many large moves are a real regime, not an outlier — clipping must not
    quietly erase them, or the estimator would understate true risk."""
    from app.services.quant import winsorize

    volatile = [0.08, -0.09, 0.07, -0.08, 0.09, -0.07] * 8
    assert winsorize(volatile) == pytest.approx(volatile)


def test_measured_vol_recovers_the_generating_sigma():
    series = make_series(sigma=0.28)
    stats = compute_stats(series)
    assert stats is not None
    assert stats.vol == pytest.approx(0.28, abs=0.06)


def test_drift_is_shrunk_toward_the_market_prior():
    """A wildly trending series must not produce a wildly trending forecast."""
    series = make_series(mu=0.80, sigma=0.25, seed=999)
    stats = compute_stats(series)
    params = estimate_from_history(stats)
    # The raw blend may be large; what leaves the estimator must not be.
    assert params.mu < 0.30
    assert abs(params.mu - MARKET_DRIFT) < abs(params.drift.raw - MARKET_DRIFT)


def test_no_data_collapses_to_the_market_prior():
    params = estimate_from_history(None)
    assert params.mu == pytest.approx(MARKET_DRIFT)
    assert params.vol_measured is False


def test_shrinkage_grows_with_data():
    assert shrinkage_for(0.0, 0) < shrinkage_for(0.5, 250) < shrinkage_for(1.0, 750)


def test_quality_falls_back_when_no_fundamentals():
    score = quality_score(None, 0.63)
    assert score.value == 0.63
    assert score.measured is False


def test_quality_is_measured_from_real_fundamentals():
    strong = quality_score(
        Fundamentals("A", profit_margin=0.30, return_on_equity=0.35, revenue_growth_yoy=0.25),
        0.5,
    )
    weak = quality_score(
        Fundamentals("B", profit_margin=0.01, return_on_equity=0.02, revenue_growth_yoy=-0.10),
        0.5,
    )
    assert strong.measured and weak.measured
    assert strong.value > weak.value


# --- Backtest --------------------------------------------------------------


def test_truncate_to_has_no_look_ahead():
    series = make_series(n=300)
    past = series.truncate_to(100)
    assert len(past) == 101
    assert past.closes == series.closes[:101]
    assert past.dates[-1] == series.dates[100]


def test_walk_forward_produces_calibrated_coverage_on_gbm():
    """On data generated by the model's own process, coverage should land near
    the nominal 50% / 90%. Wide tolerance: 24 overlapping windows is a small
    effective sample, which is exactly why independent_windows is reported."""
    series = make_series(n=760, mu=0.10, sigma=0.28)
    report = walk_forward(series, 90, origins=24, min_history=180)
    assert report is not None
    assert report.windows >= 20
    assert 0.25 <= report.coverage_50 <= 0.85
    assert 0.70 <= report.coverage_90 <= 1.0
    assert report.independent_windows <= report.windows


def test_walk_forward_returns_none_without_enough_history():
    assert walk_forward(make_series(n=120), 90, min_history=180) is None


def test_backtest_marked_unmeasured_without_history():
    """The engine must not manufacture a track record it does not have."""
    forecast = analyze_stock("AAPL", 90)
    assert forecast.backtest.measured is False
    assert forecast.backtest.windows == 0


# --- Risk model ------------------------------------------------------------


def _positions() -> list[Position]:
    return [
        Position("AAPL", 0.30, 1.20, 0.28),
        Position("VTI", 0.45, 1.00, 0.16),
        Position("BND", 0.20, 0.15, 0.06),
        Position("CASH", 0.05, 0.00, 0.002),
    ]


def test_risk_contributions_sum_to_portfolio_volatility():
    """The defining identity of marginal risk attribution: sum_i w_i * MCR_i
    equals sigma_p exactly. If this drifts, every risk share shown is wrong."""
    positions = _positions()
    total = sum(
        p.weight * marginal_contribution(positions, i) for i, p in enumerate(positions)
    )
    assert total == pytest.approx(decompose(positions).volatility, rel=1e-9)


def test_diversification_reduces_volatility():
    """Ten equal small positions must be less volatile than one concentrated
    position of the same average volatility — idiosyncratic risk scales with
    the sum of squared weights."""
    concentrated = [Position("ONE", 1.0, 1.1, 0.30)]
    spread = [Position(f"S{i}", 0.1, 1.1, 0.30) for i in range(10)]
    assert decompose(spread).volatility < decompose(concentrated).volatility


def test_effective_positions_matches_equal_weighting():
    spread = [Position(f"S{i}", 0.2, 1.0, 0.2) for i in range(5)]
    assert decompose(spread).effective_positions == pytest.approx(5.0)


def test_cash_carries_no_market_beta():
    cash_only = [Position("CASH", 1.0, 0.0, 0.002)]
    assert decompose(cash_only).beta == pytest.approx(0.0)
    assert decompose(cash_only).volatility < 0.01


def test_value_at_risk_scales_with_sqrt_time():
    quarter = value_at_risk(0.20, 0.25)
    year = value_at_risk(0.20, 1.0)
    assert year / quarter == pytest.approx(2.0, rel=1e-6)


def test_max_weight_respects_the_ceiling():
    positions = _positions()
    candidate = Position("RISKY", 0.0, 1.5, 0.60)
    weight = max_weight_under_vol(positions, candidate, 0.18)
    assert 0.0 <= weight <= 1.0

    scaled = [
        Position(p.label, p.weight * (1 - weight), p.beta, p.vol) for p in positions
    ]
    scaled.append(Position("RISKY", weight, 1.5, 0.60))
    assert decompose(scaled).volatility <= 0.18 + 1e-6


def test_higher_volatility_lowers_the_max_weight():
    positions = _positions()
    calm = max_weight_under_vol(positions, Position("C", 0.0, 0.7, 0.12), 0.18)
    wild = max_weight_under_vol(positions, Position("W", 0.0, 1.6, 0.70), 0.18)
    assert wild < calm


# --- Impact integration ----------------------------------------------------


PROFILE = InvestorProfile(
    age=30,
    income=90000,
    contribution=1000,
    horizon=20,
    risk=3,
    emergency=6,
    goal="long_term_growth",
    liquidity="medium",
)


def _holdings() -> list[Holding]:
    return [
        Holding(
            symbol="VTI",
            name="Vanguard Total Market",
            type="etf",
            asset="us_equity",
            sector="broad_market",
            value=60000,
        ),
        Holding(
            symbol="BND",
            name="Bonds",
            type="etf",
            asset="bonds",
            sector="broad_market",
            value=30000,
        ),
    ]


def test_impact_reports_risk_share_above_weight_for_a_volatile_name():
    """The finding a weights-only view cannot surface: a high-vol position
    carries more risk than its size implies."""
    series = make_series(sigma=0.55, seed=4242)
    stats = compute_stats(series)
    ctx = MarketContext(
        snapshot=MarketSnapshot(
            "WILD", price=series.closes[-1], sector="technology", source="alphavantage"
        ),
        series=series,
        stats=stats,
    )
    forecast = analyze_stock("WILD", 90, ctx)
    impact = compute_impact(forecast, _holdings(), PROFILE)

    assert impact is not None
    assert impact.risk_contribution > impact.new_weight
    assert impact.vol_after > impact.vol_before
    assert impact.var95_after > impact.var95_before
    # Attribution shares must still sum to one across the post-trade book.
    assert sum(c.risk_contribution for c in impact.top_risk_contributors) == pytest.approx(
        1.0, abs=1e-6
    )


def test_impact_is_none_without_holdings():
    forecast = analyze_stock("AAPL", 30)
    assert compute_impact(forecast, [], PROFILE) is None


def test_forecast_fields_are_internally_consistent():
    forecast = analyze_stock("AAPL", 90)
    assert forecast.bear_target < forecast.q25_target < forecast.median_target
    assert forecast.median_target < forecast.q75_target < forecast.bull_target
    # `expected` is the median return, so it must agree with the median target.
    assert forecast.median_target == pytest.approx(
        forecast.price * (1 + forecast.expected), rel=1e-9
    )
    # The mean of a lognormal sits above its median whenever sigma > 0.
    assert forecast.expected_mean > forecast.expected


def test_price_divergence_guard_prefers_the_series_close():
    """A quote far from the daily series it is paired with is a structural
    mismatch (unadjusted split, bad tick, symbol collision), not an intraday
    move. Anchoring the cone on it while measuring sigma from the series would
    describe two different instruments in one forecast."""
    from app.marketdata.resolver import _reconcile_price

    ctx = MarketContext(
        snapshot=MarketSnapshot("X", price=0.0002, source="alphavantage", as_of="2026-07-23")
    )
    _reconcile_price(ctx, 308.36, "2026-07-22")
    assert ctx.snapshot.price == 308.36
    assert ctx.snapshot.as_of == "2026-07-22"
    assert ctx.warnings and "diverges" in ctx.warnings[0]


def test_price_divergence_guard_allows_normal_intraday_moves():
    from app.marketdata.resolver import _reconcile_price

    ctx = MarketContext(snapshot=MarketSnapshot("X", price=104.0, source="alphavantage"))
    _reconcile_price(ctx, 100.0, "2026-07-22")
    assert ctx.snapshot.price == 104.0  # a 4% move is just a market day
    assert not ctx.warnings


def test_currency_formatting_survives_sub_dollar_prices():
    """Penny stocks are real; "$0" reads as missing data, not a small number."""
    from app.services.ai.format import currency

    assert currency(1234.6) == "$1,235"
    assert currency(45.5) == "$45.50"
    assert currency(0.0002) == "$0.0002"


def test_wire_names_match_the_typescript_types():
    """The camel-case generator uppercases the letter after a digit, so
    `return_3m` would serialize as `return3M`. The frontend types use
    `return3m`, and a mismatch makes the field silently undefined in the UI
    rather than failing loudly — so the wire names are pinned here."""
    series = make_series()
    ctx = MarketContext(
        snapshot=MarketSnapshot("T", price=series.closes[-1], source="alphavantage"),
        series=series,
        stats=compute_stats(series),
    )
    payload = analyze_stock("T", 90, ctx).model_dump(by_alias=True, mode="json")
    stats = payload["stats"]

    for key in (
        "return1m",
        "return3m",
        "return6m",
        "return12m",
        "momentum12m1",
        "high52w",
        "low52w",
        "pctOf52wRange",
        "maxDrawdown",
        "volSimple",
        "sharpeTrailing",
    ):
        assert key in stats, f"missing wire key {key}"

    # These carry digits too and must keep their lowercase-after-digit form.
    for key in ("q25Target", "q75Target", "probDrawdown10", "probDrawdown20"):
        assert key in payload, f"missing wire key {key}"
    for key in ("coverage50", "coverage90", "independentWindows"):
        assert key in payload["backtest"], f"missing wire key {key}"


def _deep_context(symbol="DEEP", **kwargs) -> MarketContext:
    """A context with every input populated — the fully-measured path."""
    series = make_series(**kwargs)
    return MarketContext(
        snapshot=MarketSnapshot(
            symbol,
            price=series.closes[-1],
            name="Deep Co.",
            sector="technology",
            source="alphavantage",
        ),
        series=series,
        stats=compute_stats(series),
        fundamentals=Fundamentals(
            symbol,
            beta=1.18,
            pe_ratio=27.4,
            peg_ratio=1.42,
            profit_margin=0.22,
            return_on_equity=0.31,
            revenue_growth_yoy=0.14,
            analyst_target=series.closes[-1] * 1.12,
        ),
        sentiment=0.2,
        sentiment_articles=18,
        sources=["daily:live", "overview:live"],
    )


def test_full_pipeline_renders_a_memo_with_measured_stats():
    """The template memo reads fields off the stats and backtest models. Those
    branches only run when real history is present, so an offline-only test
    suite never touches them — which is exactly how a field rename slipped
    through to a 500 at runtime."""
    from app.services.ai.memo import template_memo

    forecast = analyze_stock("DEEP", 90, _deep_context())
    assert forecast.stats is not None
    assert forecast.backtest.measured

    lines = template_memo(forecast, compute_impact(forecast, _holdings(), PROFILE))
    body = " ".join(lines)
    assert "52-week range" in body
    assert "25-75 band" in body
    assert "independent horizons" in body
    assert all(isinstance(line, str) and line for line in lines)


def test_full_pipeline_serializes_end_to_end():
    """Guards every attribute access on the deep path, not just the wire keys."""
    forecast = analyze_stock("DEEP", 90, _deep_context())
    payload = forecast.model_dump(by_alias=True, mode="json")
    assert payload["stats"]["pctOf52wRange"] is not None
    assert payload["inputs"]["signals"]
    assert payload["backtest"]["measured"] is True


def test_engine_is_deterministic():
    a = analyze_stock("NVDA", 45)
    b = analyze_stock("NVDA", 45)
    assert a.model_dump() == b.model_dump()
