// Current-vs-target allocation bars, per asset class.

import { pct, title } from '../../lib/format'
import type { PortfolioAnalysis } from '../../lib/calculations/portfolio'

export function AllocationBars({ analysis }: { analysis: PortfolioAnalysis }) {
  return (
    <div className="bars">
      {Object.keys(analysis.gap).map((k) => {
        const g = analysis.gap[k]
        const cur = analysis.current[k] || 0
        const tar = analysis.target[k] || 0
        return (
          <div className="barrow" key={k}>
            <div className="bartop">
              <strong>{title(k)}</strong>
              <span>
                {g >= 0 ? 'Need' : 'Over'} {pct(Math.abs(g))}
              </span>
            </div>
            <div className="line">
              <span>Now</span>
              <div className="track">
                <div className="fill" style={{ width: `${Math.min(cur * 100, 100)}%` }} />
              </div>
            </div>
            <div className="line">
              <span>Target</span>
              <div className="track">
                <div className="fill target" style={{ width: `${Math.min(tar * 100, 100)}%` }} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
