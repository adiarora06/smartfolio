// Formatting helpers — ported from the prototype.

const whole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const cents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const subCent = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

/**
 * Currency formatter with precision that adapts to magnitude.
 *
 * Whole dollars above $100 (portfolio values, most share prices), cents from
 * $1–$100, and up to six decimals below $1. Without the last tier every
 * sub-dollar price — penny stocks, and any forecast band around one — renders
 * as "$0", which reads as missing data rather than a small number.
 */
export const fmt = {
  format(n: number): string {
    if (!Number.isFinite(n)) return '—'
    const magnitude = Math.abs(n)
    if (magnitude >= 100) return whole.format(n)
    if (magnitude >= 1) return cents.format(n)
    return subCent.format(n)
  },
}

/** Format a number as USD currency, e.g. 1234 -> "$1,234". */
export const currency = (n: number): string => fmt.format(n)

/** Format a 0..1 fraction as a percentage string, e.g. 0.123 -> "12.3%". */
export const pct = (x: number, d = 1): string => (x * 100).toFixed(d) + '%'

/** Turn a snake_case key into Title Case, e.g. "us_equity" -> "Us Equity". */
export const title = (s: string): string =>
  String(s)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
