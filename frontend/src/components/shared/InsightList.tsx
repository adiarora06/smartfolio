// A styled list of insight/recommendation lines. Warn items get the amber rail.

export interface InsightItem {
  text: string
  warn?: boolean
}

export function InsightList({ items, className }: { items: InsightItem[]; className?: string }) {
  return (
    <ul className={className ? `list ${className}` : 'list'}>
      {items.map((it, i) => (
        <li key={i} className={it.warn ? 'warn' : undefined}>
          {it.text}
        </li>
      ))}
    </ul>
  )
}
