"""Canonical reproducible strategy simulation used by the web application.

A fixed 32-bit LCG and explicit Box-Muller transform keep results stable across
runs, while monthly lognormal steps make the distribution respond to both
return and portfolio-volatility assumptions. The browser renders these results
but intentionally does not maintain a second copy of this financial model.
"""
from __future__ import annotations

import math
from typing import Callable, List

from ..schemas import (
    ContributionOptimization,
    ContributionOptimizationInputs,
    PortfolioAnalysis,
    ScenarioComparison,
    ScenarioLabRequest,
    ScenarioLabResponse,
    ScenarioSimulation,
    ScenarioSimulationInputs,
    ScenarioStrategy,
    SimulationPercentilePoint,
    SimulationTerminalRange,
)

UINT32_RANGE = 4294967297.0


def _normal_generator(seed: int) -> Callable[[], float]:
    state = seed & 0xFFFFFFFF

    def uniform() -> float:
        nonlocal state
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        return (state + 1) / UINT32_RANGE

    def normal() -> float:
        u1 = max(uniform(), 1e-12)
        u2 = uniform()
        return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)

    return normal


def _percentile(sorted_values: List[float], quantile: float) -> float:
    if not sorted_values:
        return 0.0
    position = (len(sorted_values) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return sorted_values[lower]
    weight = position - lower
    return sorted_values[lower] * (1.0 - weight) + sorted_values[upper] * weight


def _point(year: int, values: List[float]) -> SimulationPercentilePoint:
    ordered = sorted(values)
    return SimulationPercentilePoint(
        year=year,
        p10=_percentile(ordered, 0.10),
        p25=_percentile(ordered, 0.25),
        p50=_percentile(ordered, 0.50),
        p75=_percentile(ordered, 0.75),
        p90=_percentile(ordered, 0.90),
    )


def simulate_strategy(
    analysis: PortfolioAnalysis, inputs: ScenarioSimulationInputs
) -> ScenarioSimulation:
    """Simulate monthly portfolio paths from the visible strategy assumptions."""
    blended_return = (
        analysis.current_return * (1.0 - inputs.rebalance)
        + analysis.target_return * inputs.rebalance
        + inputs.return_adj
    )
    blended_return = min(max(blended_return, -0.95), 1.0)
    blended_volatility = (
        analysis.risk.annualized_volatility * (1.0 - inputs.rebalance)
        + analysis.risk.target_volatility * inputs.rebalance
    )
    blended_volatility = min(max(blended_volatility, 0.001), 1.0)

    annual_samples: List[List[float]] = [
        [analysis.value for _ in range(inputs.paths)]
    ] + [[] for _ in range(inputs.horizon_years)]
    terminal_values: List[float] = []
    normal = _normal_generator(inputs.seed)
    monthly_drift = (blended_return - 0.5 * blended_volatility**2) / 12.0
    monthly_volatility = blended_volatility / math.sqrt(12.0)

    for _ in range(inputs.paths):
        value = analysis.value
        for month in range(1, inputs.horizon_years * 12 + 1):
            value = max(
                0.0,
                value
                * math.exp(monthly_drift + monthly_volatility * normal())
                + inputs.contribution,
            )
            if month % 12 == 0:
                annual_samples[month // 12].append(value)
        terminal_values.append(value)

    points = [_point(year, values) for year, values in enumerate(annual_samples)]
    terminal = points[-1]
    contributed_floor = (
        analysis.value + inputs.contribution * 12 * inputs.horizon_years
    )
    success_count = sum(value >= inputs.goal_value for value in terminal_values)
    preserve_count = sum(value >= contributed_floor for value in terminal_values)

    return ScenarioSimulation(
        blended_return=blended_return,
        blended_volatility=blended_volatility,
        goal_value=inputs.goal_value,
        horizon_years=inputs.horizon_years,
        paths=inputs.paths,
        seed=inputs.seed,
        success_probability=success_count / inputs.paths,
        preserve_contributions_probability=preserve_count / inputs.paths,
        expected_terminal=sum(terminal_values) / inputs.paths,
        terminal=SimulationTerminalRange(
            p10=terminal.p10,
            p25=terminal.p25,
            p50=terminal.p50,
            p75=terminal.p75,
            p90=terminal.p90,
        ),
        points=points,
    )


def optimize_contribution(
    analysis: PortfolioAnalysis, inputs: ContributionOptimizationInputs
) -> ContributionOptimization:
    """Find the smallest contribution step that reaches a target probability."""

    def simulate(contribution: float) -> ScenarioSimulation:
        return simulate_strategy(
            analysis,
            ScenarioSimulationInputs(
                contribution=contribution,
                return_adj=inputs.return_adj,
                rebalance=inputs.rebalance,
                goal_value=inputs.goal_value,
                horizon_years=inputs.horizon_years,
                paths=inputs.paths,
                seed=inputs.seed,
            ),
        )

    max_steps = max(1, math.floor(inputs.max_contribution / inputs.contribution_step))
    ceiling_result = simulate(max_steps * inputs.contribution_step)
    if ceiling_result.success_probability < inputs.target_probability:
        return ContributionOptimization(
            target_probability=inputs.target_probability,
            required_contribution=max_steps * inputs.contribution_step,
            achieved_probability=ceiling_result.success_probability,
            capped=True,
            max_contribution=inputs.max_contribution,
            contribution_step=inputs.contribution_step,
        )

    low, high = 0, max_steps
    while low < high:
        midpoint = (low + high) // 2
        candidate = simulate(midpoint * inputs.contribution_step)
        if candidate.success_probability >= inputs.target_probability:
            high = midpoint
        else:
            low = midpoint + 1

    required = low * inputs.contribution_step
    result = simulate(required)

    return ContributionOptimization(
        target_probability=inputs.target_probability,
        required_contribution=required,
        achieved_probability=result.success_probability,
        capped=False,
        max_contribution=inputs.max_contribution,
        contribution_step=inputs.contribution_step,
    )


def _strategy_inputs(
    strategy: ScenarioStrategy,
    request: ScenarioLabRequest,
    *,
    paths: int,
) -> ScenarioSimulationInputs:
    return ScenarioSimulationInputs(
        contribution=strategy.contribution,
        return_adj=strategy.return_adj,
        rebalance=strategy.rebalance,
        goal_value=request.goal_value,
        horizon_years=request.horizon_years,
        paths=paths,
        seed=request.seed,
    )


def run_scenario_lab(
    analysis: PortfolioAnalysis,
    request: ScenarioLabRequest,
) -> ScenarioLabResponse:
    """Calculate the current plan, comparisons, and optimizer atomically.

    Keeping this composition in Python prevents the UI from mixing results
    produced by different model versions and avoids one HTTP request per card.
    """
    simulations: dict[tuple[float, float, float], ScenarioSimulation] = {}

    def simulate_once(strategy: ScenarioStrategy) -> ScenarioSimulation:
        key = (strategy.contribution, strategy.return_adj, strategy.rebalance)
        if key not in simulations:
            simulations[key] = simulate_strategy(
                analysis,
                _strategy_inputs(strategy, request, paths=request.simulation_paths),
            )
        return simulations[key]

    simulation = simulate_once(request.primary)
    comparisons = [
        ScenarioComparison(
            id=strategy.id,
            simulation=simulate_once(strategy),
        )
        for strategy in request.strategies
    ]
    optimization = optimize_contribution(
        analysis,
        ContributionOptimizationInputs(
            return_adj=request.primary.return_adj,
            rebalance=request.primary.rebalance,
            goal_value=request.goal_value,
            target_probability=request.target_probability,
            horizon_years=request.horizon_years,
            paths=request.optimization_paths,
            seed=request.seed,
            max_contribution=request.max_contribution,
            contribution_step=request.contribution_step,
        ),
    )
    return ScenarioLabResponse(
        simulation=simulation,
        comparisons=comparisons,
        optimization=optimization,
    )
