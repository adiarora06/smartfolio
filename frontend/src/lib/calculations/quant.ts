// Distributional forecast math — mirror of backend/app/services/quant.py.
//
// The price model is a lognormal cone (geometric Brownian motion):
//
//     ln(S_t / S_0) ~ Normal( (mu - sigma^2 / 2) * t,  sigma^2 * t )
//
// so the q-th quantile of the price at horizon t is
//
//     S_q(t) = S_0 * exp( (mu - sigma^2 / 2) * t + z_q * sigma * sqrt(t) )
//
// which is why the band widens with sqrt(t) rather than linearly.
//
// This file exists so the offline fallback draws the same shape the backend
// does. It cannot reproduce the backend's *inputs* (no price history reaches
// the browser), only its math.

/** Quantiles the cone is reported at. */
export const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95] as const

/** Long-run annualized volatility of the broad US equity market. */
export const MARKET_VOL = 0.16
/** The "no information" prior for a US equity's annualized drift. */
export const MARKET_DRIFT = 0.07

// Exact z-scores for the quantiles above. Hardcoded rather than computed so
// the frontend and backend cones agree to the last decimal.
const Z: Record<number, number> = {
  0.05: -1.6448536269514722,
  0.25: -0.6744897501960817,
  0.5: 0,
  0.75: 0.6744897501960817,
  0.95: 1.6448536269514722,
}

/** Inverse standard-normal CDF, for the fixed quantiles the cone uses. */
export function normPpf(q: number): number {
  const exact = Z[q]
  if (exact !== undefined) return exact
  // Beasley-Springer-Moro tail approximation for anything off the table.
  const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637]
  const b = [-8.47351093090, 23.08336743743, -21.06224101826, 3.13082909833]
  const c = [
    0.3374754822726147, 0.9761690190917186, 0.1607979714918209, 0.0276438810333863,
    0.0038405729373609, 0.0003951896511919, 0.0000321767881768, 0.0000002888167364,
    0.0000003960315187,
  ]
  const y = q - 0.5
  if (Math.abs(y) < 0.42) {
    const r = y * y
    return (
      (y * (((a[3] * r + a[2]) * r + a[1]) * r + a[0])) /
      ((((b[3] * r + b[2]) * r + b[1]) * r + b[0]) * r + 1)
    )
  }
  let r = q < 0.5 ? q : 1 - q
  r = Math.log(-Math.log(r))
  let x = c[0]
  for (let i = 1; i < c.length; i++) x += c[i] * Math.pow(r, i)
  return q < 0.5 ? -x : x
}

/** Standard-normal CDF via an Abramowitz-Stegun erf approximation. */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2)
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x > 0 ? 1 - p : p
}

/**
 * Clip extreme returns to ±`sigmas` sample standard deviations.
 *
 * Mirror of `winsorize` in backend/app/services/quant.py. The browser has no
 * price history today, so nothing here calls it — it exists so the two engines
 * stay in lockstep if the offline mirror ever gains a return series (e.g. from
 * a Plaid import). Clipping preserves an outlier's direction and its status as
 * a large move while stopping one bar from defining the whole distribution:
 * under EWMA(0.94) a single -25% session inflated a real IBM estimate to 104%
 * annualized.
 */
export function winsorize(returns: number[], sigmas = 4.0): number[] {
  const n = returns.length
  if (n < 20) return returns
  const mean = returns.reduce((s, r) => s + r, 0) / n
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1)
  if (variance <= 0) return returns
  const limit = sigmas * Math.sqrt(variance)
  const lo = mean - limit
  const hi = mean + limit
  return returns.map((r) => Math.min(Math.max(r, lo), hi))
}

/** Mean and stdev of ln(S_t / S_0) at horizon t (in years). */
export function logMoments(mu: number, sigma: number, t: number): [number, number] {
  return [(mu - 0.5 * sigma * sigma) * t, sigma * Math.sqrt(Math.max(t, 0))]
}

/** Price at the q-th quantile of the horizon-t distribution. */
export function quantilePrice(
  s0: number,
  mu: number,
  sigma: number,
  t: number,
  q: number,
): number {
  const [m, s] = logMoments(mu, sigma, t)
  return s0 * Math.exp(m + normPpf(q) * s)
}

/** Total return (decimal) at the q-th quantile of the horizon-t distribution. */
export function quantileReturn(mu: number, sigma: number, t: number, q: number): number {
  const [m, s] = logMoments(mu, sigma, t)
  return Math.exp(m + normPpf(q) * s) - 1
}

/** P(S_t > target) under the lognormal model. */
export function probAbove(
  s0: number,
  target: number,
  mu: number,
  sigma: number,
  t: number,
): number {
  if (s0 <= 0 || target <= 0 || t <= 0 || sigma <= 0) return 0.5
  const [m, s] = logMoments(mu, sigma, t)
  return 1 - normCdf((Math.log(target / s0) - m) / s)
}

/** P(the position is up over the horizon) — the honest "confidence" number. */
export function probGain(mu: number, sigma: number, t: number): number {
  const [m, s] = logMoments(mu, sigma, t)
  if (s <= 0) return m > 0 ? 1 : 0
  return 1 - normCdf(-m / s)
}

/**
 * P(the price touches -depth at any point before t).
 * Closed-form first-passage probability for Brownian motion with drift — a
 * path property, so strictly larger than the terminal probability of ending
 * below the same barrier.
 */
export function probDrawdown(mu: number, sigma: number, t: number, depth: number): number {
  if (depth <= 0 || depth >= 1 || t <= 0 || sigma <= 0) return 0
  const b = Math.log(1 - depth)
  const nu = mu - 0.5 * sigma * sigma
  const s = sigma * Math.sqrt(t)
  const first = normCdf((b - nu * t) / s)
  const exponent = Math.min((2 * nu * b) / (sigma * sigma), 700)
  const second = Math.exp(exponent) * normCdf((b + nu * t) / s)
  return Math.min(Math.max(first + second, 0), 1)
}
