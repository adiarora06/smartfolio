"""Portfolio risk model — single-index (market-factor) decomposition.

Every holding's return is modelled as a market component plus an independent
idiosyncratic component:

    r_i = alpha_i + beta_i * r_market + e_i,     Var(e_i) = sigma_e,i^2

which gives the total variance of a holding and of the portfolio:

    sigma_i^2 = beta_i^2 * sigma_m^2 + sigma_e,i^2
    sigma_p^2 = (sum_i w_i beta_i)^2 * sigma_m^2 + sum_i w_i^2 * sigma_e,i^2

The second term is the one that shrinks as positions get smaller and more
numerous — this is where diversification actually comes from, and why adding a
tenth position of the same size reduces risk far less than the first.

Why a single factor rather than a full covariance matrix: estimating an N x N
covariance from a user's handful of holdings would be dominated by estimation
error, and we do not have return histories for every position anyway. One
factor plus documented per-sector betas is the honest amount of structure for
the data available. The per-sector figures below are assumptions, labelled as
such, not measurements.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from ..schemas import Holding
from .quant import MARKET_VOL, norm_ppf

# Assumed (beta, annualized total volatility) by equity sector. Betas are
# long-run sector averages against the S&P 500; vols are typical realized
# annualized figures. Used only for holdings we have no measured history for.
SECTOR_RISK: Dict[str, Tuple[float, float]] = {
    "technology": (1.20, 0.28),
    "communication_services": (1.05, 0.24),
    "consumer_cyclical": (1.15, 0.27),
    "financial_services": (1.10, 0.24),
    "healthcare": (0.85, 0.20),
    "industrial": (1.00, 0.21),
    "energy": (1.05, 0.30),
    "utilities": (0.55, 0.16),
    "consumer_defensive": (0.65, 0.15),
    "real_estate": (0.95, 0.22),
    "basic_materials": (1.05, 0.24),
    "broad_market": (1.00, 0.16),
}

# Assumed (beta, annualized total volatility) by asset class — the fallback
# when a holding has no recognized sector.
ASSET_RISK: Dict[str, Tuple[float, float]] = {
    "us_equity": (1.00, 0.17),
    "intl_equity": (0.90, 0.19),
    "bonds": (0.15, 0.06),
    "cash": (0.00, 0.002),
    "alternatives": (0.50, 0.14),
    "crypto": (1.40, 0.65),
    "other": (0.60, 0.18),
}


@dataclass(frozen=True)
class Position:
    """A holding reduced to what the risk model needs."""

    label: str
    weight: float
    beta: float
    vol: float
    measured: bool = False  # True when vol/beta came from real data

    @property
    def idiosyncratic_var(self) -> float:
        """Variance not explained by the market factor. Floored at zero —
        a holding whose assumed vol is below its beta-implied market vol would
        otherwise produce a negative variance."""
        systematic = (self.beta * MARKET_VOL) ** 2
        return max(self.vol**2 - systematic, 0.0)


@dataclass(frozen=True)
class RiskDecomposition:
    """Portfolio risk, split into the parts that behave differently."""

    volatility: float  # annualized
    systematic: float  # market-driven component of volatility
    idiosyncratic: float  # diversifiable component
    beta: float  # portfolio beta to the market
    diversification_ratio: float  # weighted-average vol / portfolio vol
    effective_positions: float  # inverse Herfindahl of weights


def risk_inputs(holding: Holding) -> Tuple[float, float]:
    """(beta, vol) assumption for a holding, sector first then asset class."""
    if holding.asset in ("us_equity", "intl_equity"):
        by_sector = SECTOR_RISK.get(holding.sector)
        if by_sector:
            return by_sector
    return ASSET_RISK.get(holding.asset, ASSET_RISK["other"])


def positions_from_holdings(
    holdings: List[Holding], total: Optional[float] = None
) -> List[Position]:
    total = total if total is not None else sum(float(h.value or 0) for h in holdings)
    if total <= 0:
        return []
    out: List[Position] = []
    for h in holdings:
        beta, vol = risk_inputs(h)
        out.append(
            Position(
                label=h.symbol,
                weight=float(h.value) / total,
                beta=beta,
                vol=vol,
            )
        )
    return out


def decompose(positions: List[Position]) -> RiskDecomposition:
    """Full single-index decomposition of a weighted position set."""
    if not positions:
        return RiskDecomposition(0.0, 0.0, 0.0, 0.0, 1.0, 0.0)

    portfolio_beta = sum(p.weight * p.beta for p in positions)
    systematic_var = (portfolio_beta * MARKET_VOL) ** 2
    idiosyncratic_var = sum(p.weight**2 * p.idiosyncratic_var for p in positions)
    total_var = systematic_var + idiosyncratic_var
    vol = math.sqrt(max(total_var, 0.0))

    weighted_vol = sum(p.weight * p.vol for p in positions)
    diversification = weighted_vol / vol if vol > 0 else 1.0

    weight_sq = sum(p.weight**2 for p in positions)
    effective = 1.0 / weight_sq if weight_sq > 0 else 0.0

    return RiskDecomposition(
        volatility=vol,
        systematic=math.sqrt(max(systematic_var, 0.0)),
        idiosyncratic=math.sqrt(max(idiosyncratic_var, 0.0)),
        beta=portfolio_beta,
        diversification_ratio=diversification,
        effective_positions=effective,
    )


def marginal_contribution(positions: List[Position], index: int) -> float:
    """d(sigma_p) / d(w_i) — how much portfolio vol moves per unit of weight.

    Weight-times-this summed over all positions equals portfolio volatility
    exactly, which is what makes it the right attribution of risk to a holding.
    """
    if not positions or index >= len(positions):
        return 0.0
    decomposition = decompose(positions)
    if decomposition.volatility <= 0:
        return 0.0
    portfolio_beta = sum(p.weight * p.beta for p in positions)
    p = positions[index]
    numerator = (
        p.beta * portfolio_beta * MARKET_VOL**2 + p.weight * p.idiosyncratic_var
    )
    return numerator / decomposition.volatility


def value_at_risk(volatility: float, horizon_years: float, confidence: float = 0.95) -> float:
    """Parametric VaR as a positive decimal loss fraction over the horizon.

    Normal rather than lognormal here because VaR is quoted on simple returns
    and the difference is immaterial at portfolio-level vols and horizons
    under a year.
    """
    if volatility <= 0 or horizon_years <= 0:
        return 0.0
    return abs(norm_ppf(1 - confidence)) * volatility * math.sqrt(horizon_years)


def max_weight_under_vol(
    positions: List[Position],
    candidate: Position,
    vol_ceiling: float,
) -> float:
    """Largest weight for `candidate` keeping portfolio vol at/below the ceiling.

    Solved by bisection rather than algebraically: the objective is monotonic in
    the candidate weight once the other positions are renormalized, so twenty
    iterations land well inside rounding tolerance and the code stays readable.
    """
    if vol_ceiling <= 0:
        return 0.0

    def vol_at(weight: float) -> float:
        scale = 1.0 - weight
        blended = [
            Position(p.label, p.weight * scale, p.beta, p.vol, p.measured)
            for p in positions
        ]
        blended.append(
            Position(
                candidate.label, weight, candidate.beta, candidate.vol, candidate.measured
            )
        )
        return decompose(blended).volatility

    if vol_at(0.0) > vol_ceiling:
        return 0.0
    if vol_at(1.0) <= vol_ceiling:
        return 1.0

    low, high = 0.0, 1.0
    for _ in range(20):
        mid = (low + high) / 2
        if vol_at(mid) <= vol_ceiling:
            low = mid
        else:
            high = mid
    return low
