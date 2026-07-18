// Formatting helpers — ported from the prototype.

export const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** Format a number as USD currency, e.g. 1234 -> "$1,234". */
export const currency = (n: number): string => fmt.format(n)

/** Format a 0..1 fraction as a percentage string, e.g. 0.123 -> "12.3%". */
export const pct = (x: number, d = 1): string => (x * 100).toFixed(d) + '%'

/** Turn a snake_case key into Title Case, e.g. "us_equity" -> "Us Equity". */
export const title = (s: string): string =>
  String(s)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
