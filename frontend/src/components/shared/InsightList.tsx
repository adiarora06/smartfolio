// A styled list of insight/recommendation lines. Warn items get the amber
// rail. Items with a `stat` lead with the number so the value is scannable.

export interface InsightItem {
  text: string
  /** Optional headline figure shown before the text (e.g. "28%"). */
  stat?: string
  warn?: boolean
}

export function InsightList({ items, className }: { items: InsightItem[]; className?: string }) {
  return (
    <ul className={className ? `list ${className}` : 'list'}>
      {items.map((it, i) => (
        <li key={i} className={it.warn ? 'warn' : undefined}>
          {it.stat != null && <strong className="insightStat">{it.stat}</strong>}
          {it.text}
        </li>
      ))}
    </ul>
  )
}
