// Small presentational primitives shared across screens.
// These keep the ported markup (and its class names) in one place.

import type { ReactNode } from 'react'

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={className ? `panel ${className}` : 'panel'}>{children}</section>
}

export function PanelHead({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="head">
      <h2>{title}</h2>
      {subtitle != null && <p>{subtitle}</p>}
    </div>
  )
}

/** The gradient header block at the top of each app screen. */
export function AppHero({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="appHero">
      <div>
        <h1>{title}</h1>
        {subtitle != null && <p>{subtitle}</p>}
      </div>
      {actions != null && <div className="actions">{actions}</div>}
    </div>
  )
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="metrics">{children}</div>
}

export function MetricCard({
  label,
  value,
  sub,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub != null && <small>{sub}</small>}
    </div>
  )
}
