// Shared SVG donut chart — no chart library, matches the app's hand-drawn
// chart style. Used on the landing hero and the Portfolio screen.

export interface DonutSegment {
  label: string
  pct: number
  color: string
}

export function DonutChart({
  segments,
  centerTitle,
  centerSub,
  size = 140,
  centerColor = 'var(--ink)',
  subColor = 'var(--muted)',
}: {
  segments: DonutSegment[]
  centerTitle: string
  centerSub?: string
  size?: number
  centerColor?: string
  subColor?: string
}) {
  const R = 40
  const C = 2 * Math.PI * R
  let cumulative = 0
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Allocation donut chart"
    >
      {segments.map((s) => {
        const offset = (cumulative / 100) * C
        cumulative += s.pct
        return (
          <circle
            key={s.label}
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth="14"
            strokeDasharray={`${Math.max((s.pct / 100) * C - 1.5, 0.5)} ${C}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 60 60)"
          />
        )
      })}
      <text x="60" y="56" textAnchor="middle" fill={centerColor} fontSize="15" fontWeight="800">
        {centerTitle}
      </text>
      {centerSub != null && (
        <text x="60" y="72" textAnchor="middle" fill={subColor} fontSize="9" fontWeight="700">
          {centerSub}
        </text>
      )}
    </svg>
  )
}
