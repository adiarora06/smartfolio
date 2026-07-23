"""Distributional forecast math — the quantitative core.

Everything here is closed-form and deterministic: the same inputs always return
the same numbers. No sampling, no randomness, no hidden state.

The price model is a lognormal cone (geometric Brownian motion):

    ln(S_t / S_0) ~ Normal( (mu - sigma^2 / 2) * t,  sigma^2 * t )

so the q-th quantile of the price at horizon t is

    S_q(t) = S_0 * exp( (mu - sigma^2 / 2) * t + z_q * sigma * sqrt(t) )

which is why the band widens with sqrt(t) rather than linearly — the defining
visual property of a real confidence cone.

`sigma` is annualized realized volatility measured from actual returns.
`mu` is an annualized drift blended from real signals and then shrunk hard
toward the market baseline: raw momentum and analyst targets are noisy
estimators of future return, and an unshrunk blend would overstate conviction.

Mirrored in frontend/src/lib/calculations/quant.ts for offline parity.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import NormalDist
from typing import Dict, List, Optional

_N = NormalDist()

# Quantiles the cone is reported at. 0.25/0.75 is the interquartile band the UI
# shades most strongly; 0.05/0.95 is the outer band.
QUANTILES = (0.05, 0.25, 0.50, 0.75, 0.95)

# Long-run annualized volatility of the broad US equity market. Used as the
# single-factor market risk anchor and as the vol fallback.
MARKET_VOL = 0.16
# Long-run annualized equity risk premium + risk-free, i.e. the "no information"
# prior for a US equity's drift. Every blended drift is shrunk toward this.
MARKET_DRIFT = 0.07

# Trading days per year — converts daily return statistics to annualized ones.
TRADING_DAYS = 252

# Analyst price targets are structurally optimistic; published studies put the
# bias in the low-double-digit percent range over a 12-month horizon. We remove
# a conservative slice of it before using the target as a drift signal.
ANALYST_OPTIMISM_BIAS = 0.08

# Hard bounds on the annualized drift estimate. A forecast engine that projects
# a +300%/yr drift off three months of momentum is not a forecast engine.
DRIFT_FLOOR = -0.35
DRIFT_CEILING = 0.45


def norm_ppf(q: float) -> float:
    """Inverse standard-normal CDF (the z-score for quantile q)."""
    return _N.inv_cdf(min(max(q, 1e-6), 1 - 1e-6))


def norm_cdf(x: float) -> float:
    """Standard-normal CDF."""
    return _N.cdf(x)


def annualize_vol(daily_stdev: float) -> float:
    """Daily return stdev -> annualized volatility."""
    return daily_stdev * math.sqrt(TRADING_DAYS)


@dataclass(frozen=True)
class DriftSignal:
    """One annualized drift estimate plus how much to trust it."""

    name: str
    value: float
    weight: float
    detail: str


@dataclass(frozen=True)
class DriftEstimate:
    """The blended annualized drift and the audit trail behind it."""

    mu: float
    raw: float
    shrinkage: float
    signals: List[DriftSignal]


def blend_drift(signals: List[DriftSignal], shrinkage: float) -> DriftEstimate:
    """Weighted-average the available signals, then shrink toward the market.

    `shrinkage` is the weight kept on the blended signal (0 = ignore the
    signals entirely and use the market prior, 1 = trust them fully). It is
    driven by how much real data actually arrived, so a ticker analyzed with no
    history and no fundamentals collapses to the honest market baseline instead
    of inventing conviction.
    """
    usable = [s for s in signals if s.weight > 0]
    total_weight = sum(s.weight for s in usable)
    raw = (
        sum(s.value * s.weight for s in usable) / total_weight
        if total_weight > 0
        else MARKET_DRIFT
    )
    shrinkage = min(max(shrinkage, 0.0), 1.0)
    mu = MARKET_DRIFT + shrinkage * (raw - MARKET_DRIFT)
    mu = min(max(mu, DRIFT_FLOOR), DRIFT_CEILING)
    return DriftEstimate(mu=mu, raw=raw, shrinkage=shrinkage, signals=usable)


def log_moments(mu: float, sigma: float, t: float) -> tuple[float, float]:
    """Mean and stdev of ln(S_t / S_0) at horizon t (in years)."""
    m = (mu - 0.5 * sigma * sigma) * t
    s = sigma * math.sqrt(max(t, 0.0))
    return m, s


def quantile_price(s0: float, mu: float, sigma: float, t: float, q: float) -> float:
    """Price at the q-th quantile of the horizon-t distribution."""
    m, s = log_moments(mu, sigma, t)
    return s0 * math.exp(m + norm_ppf(q) * s)


def quantile_return(mu: float, sigma: float, t: float, q: float) -> float:
    """Total return (decimal) at the q-th quantile of the horizon-t distribution."""
    m, s = log_moments(mu, sigma, t)
    return math.exp(m + norm_ppf(q) * s) - 1.0


def prob_above(s0: float, target: float, mu: float, sigma: float, t: float) -> float:
    """P(S_t > target) under the lognormal model."""
    if s0 <= 0 or target <= 0 or t <= 0 or sigma <= 0:
        return 0.5
    m, s = log_moments(mu, sigma, t)
    return 1.0 - norm_cdf((math.log(target / s0) - m) / s)


def prob_gain(mu: float, sigma: float, t: float) -> float:
    """P(the position is up over the horizon) — the honest 'confidence' number."""
    m, s = log_moments(mu, sigma, t)
    if s <= 0:
        return 1.0 if m > 0 else 0.0
    return 1.0 - norm_cdf(-m / s)


def prob_drawdown(mu: float, sigma: float, t: float, depth: float) -> float:
    """P(the price touches -depth at any point before t).

    Closed-form first-passage probability for Brownian motion with drift — this
    is a path property, not a terminal one, so it is strictly larger than the
    terminal probability of ending below the barrier.
    """
    if depth <= 0 or depth >= 1 or t <= 0 or sigma <= 0:
        return 0.0
    b = math.log(1.0 - depth)  # negative log-barrier
    nu = mu - 0.5 * sigma * sigma
    s = sigma * math.sqrt(t)
    first = norm_cdf((b - nu * t) / s)
    # exp() guard: deep barriers with strong drift overflow without a clamp.
    exponent = min(2.0 * nu * b / (sigma * sigma), 700.0)
    second = math.exp(exponent) * norm_cdf((b + nu * t) / s)
    return min(max(first + second, 0.0), 1.0)


def cone(
    s0: float,
    mu: float,
    sigma: float,
    t: float,
    steps: int = 24,
    quantiles: tuple[float, ...] = QUANTILES,
) -> List[Dict[str, float]]:
    """The fan: quantile prices at each step from now to the horizon.

    Step 0 is the anchor — every quantile equals the spot price, because there
    is no uncertainty about today. The band opens from that single point.
    """
    out: List[Dict[str, float]] = []
    for i in range(steps + 1):
        ti = t * (i / steps)
        point: Dict[str, float] = {"t": ti, "day": ti * 365.0}
        for q in quantiles:
            point[f"q{int(round(q * 100)):02d}"] = quantile_price(s0, mu, sigma, ti, q)
        out.append(point)
    return out


# Returns beyond this many sample standard deviations are clipped before any
# volatility is estimated. See `winsorize`.
WINSOR_SIGMAS = 4.0


def winsorize(returns: List[float], sigmas: float = WINSOR_SIGMAS) -> List[float]:
    """Clip extreme returns to +/- `sigmas` sample standard deviations.

    Without this a single observation can define the forecast. A real case:
    IBM's daily series contains a -25% session six trading days before the
    series end. Under EWMA(0.94) that one bar still carries ~0.69 of the
    newest bar's weight, and it dragged the annualized estimate to 104% for a
    stock whose actual volatility is under 30% — producing a forecast cone
    several times too wide.

    Clipping rather than dropping keeps the observation's direction and its
    status as a large move, so a genuine regime change still widens the band
    through the accumulation of many moderate-to-large returns. What it
    prevents is one bar — whether a real crash, an unadjusted split, or a bad
    tick — deciding the whole distribution.
    """
    n = len(returns)
    if n < 20:
        return returns
    mean = sum(returns) / n
    var = sum((r - mean) ** 2 for r in returns) / (n - 1)
    if var <= 0:
        return returns
    limit = sigmas * math.sqrt(var)
    lo, hi = mean - limit, mean + limit
    return [min(max(r, lo), hi) for r in returns]


def ewma_vol(returns: List[float], lam: float = 0.94) -> Optional[float]:
    """RiskMetrics EWMA annualized volatility, over winsorized returns.

    Exponential weighting means a volatility regime change shows up in the
    forecast band within weeks instead of being averaged away over the whole
    sample, which is the behaviour you want for a 30-90 day horizon. The cost
    is extreme sensitivity to the most recent bars, which is why the input is
    winsorized first.
    """
    if len(returns) < 20:
        return None
    clipped = winsorize(returns)
    var = sum(r * r for r in clipped[:20]) / 20
    for r in clipped[20:]:
        var = lam * var + (1 - lam) * r * r
    if var <= 0:
        return None
    return annualize_vol(math.sqrt(var))


def stdev_vol(returns: List[float]) -> Optional[float]:
    """Plain annualized sample volatility over the full window.

    Equal weighting already dilutes a single outlier across the whole sample,
    so this is far more robust than the EWMA — which is exactly why the two are
    blended in services/estimate.py rather than trusting either alone.
    """
    n = len(returns)
    if n < 20:
        return None
    mean = sum(returns) / n
    var = sum((r - mean) ** 2 for r in returns) / (n - 1)
    if var <= 0:
        return None
    return annualize_vol(math.sqrt(var))


def downside_vol(returns: List[float]) -> Optional[float]:
    """Annualized volatility of negative returns only (Sortino denominator).

    Winsorized on the same basis as the other estimators — a single crash bar
    would otherwise dominate this even more than it does the two-sided vol.
    """
    n = len(returns)
    if n < 20:
        return None
    returns = winsorize(returns)
    losses = [r for r in returns if r < 0]
    if len(losses) < 5:
        return None
    var = sum(r * r for r in losses) / n
    if var <= 0:
        return None
    return annualize_vol(math.sqrt(var))
