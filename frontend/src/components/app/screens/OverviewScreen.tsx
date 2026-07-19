// Command-center overview: headline metrics, target allocation, insight queue.

import { useStore } from '../../../store/useStore'
import { usePortfolioAnalysis } from '../../../hooks/usePortfolioAnalysis'
import { fmt, pct, title } from '../../../lib/format'
import { AppHero, MetricCard, MetricGrid, Panel, PanelHead } from '../../shared/ui'
import { AllocationBars } from '../../shared/AllocationBars'
import { InsightList, type InsightItem } from '../../shared/InsightList'

export function OverviewScreen() {
  const analysis = usePortfolioAnalysis()
  const holdings = useStore((s) => s.holdings)
  const stock = useStore((s) => s.stock)
  const setScreen = useStore((s) => s.setScreen)

  // Stat-first insight items straight from the structured findings — the
  // number leads, the words stay short.
  const insightItems: InsightItem[] = [
    ...analysis.concentrations.map((f) => ({
      stat: pct(f.weight),
      text:
        f.kind === 'single_stock'
          ? `${f.label} — single stock`
          : f.kind === 'stock_aggregate'
            ? 'in individual stocks'
            : `${title(f.label)} sector`,
      warn: true,
    })),
    ...analysis.recommendations.slice(0, 3).map((s) => ({
      text:
        s.kind === 'increase'
          ? `Add ${title(s.asset ?? '')}`
          : s.kind === 'reduce'
            ? `Trim ${title(s.asset ?? '')}`
            : 'Shift into broad funds over time',
    })),
  ]
  if (!analysis.concentrations.length) {
    insightItems.unshift({ stat: '0', text: 'concentration flags — well diversified' })
  }

  return (
    <section className="screen active" id="overview">
      <AppHero
        title="SmartFolio command center"
        subtitle="Your portfolio at a glance — value, risk, allocation, next actions."
        actions={
          <>
            <button onClick={() => setScreen('stock')}>Analyze Stock</button>
            <button className="primary" onClick={() => setScreen('connections')}>
              Connect Apps
            </button>
          </>
        }
      />

      <MetricGrid>
        <MetricCard label="Portfolio Value" value={fmt.format(analysis.value)} sub={`${holdings.length} holdings`} />
        <MetricCard label="Risk Profile" value={title(analysis.riskProfileName)} sub={`Score ${analysis.riskScore.toFixed(4)}`} />
        <MetricCard label="Current 1Y" value={pct(analysis.currentReturn)} sub={`Target ${pct(analysis.targetReturn)}`} />
        <MetricCard label="Analyze Stock" value={stock.symbol} sub={stock.rating} />
      </MetricGrid>

      <div className="grid2">
        <Panel>
          <PanelHead title="Target Allocation" subtitle="Now vs your risk target." />
          <div className="body">
            <AllocationBars analysis={analysis} />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="AI Insight Queue" subtitle="What needs attention first." />
          <div className="body">
            <InsightList items={insightItems} />
          </div>
        </Panel>
      </div>
    </section>
  )
}
