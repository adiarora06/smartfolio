// Command-center overview: headline metrics, target allocation, insight queue.

import { useStore } from '../../../store/useStore'
import { usePortfolioAnalysis } from '../../../hooks/usePortfolioAnalysis'
import { describeInsights } from '../../../lib/ai/insights'
import { fmt, pct, title } from '../../../lib/format'
import { AppHero, MetricCard, MetricGrid, Panel, PanelHead } from '../../shared/ui'
import { AllocationBars } from '../../shared/AllocationBars'
import { InsightList, type InsightItem } from '../../shared/InsightList'

export function OverviewScreen() {
  const analysis = usePortfolioAnalysis()
  const holdings = useStore((s) => s.holdings)
  const stock = useStore((s) => s.stock)
  const setScreen = useStore((s) => s.setScreen)

  const { flags, recommendations } = describeInsights(analysis)
  const insightItems: InsightItem[] = [
    ...flags.map((text) => ({ text, warn: true })),
    ...recommendations.slice(0, 3).map((text) => ({ text })),
  ]

  return (
    <section className="screen active" id="overview">
      <AppHero
        title="SmartFolio command center"
        subtitle="Manage profile, portfolio, scenarios, connected data sources, and Analyze Stock."
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
          <PanelHead title="Target Allocation" subtitle="Current allocation compared with risk target." />
          <div className="body">
            <AllocationBars analysis={analysis} />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="AI Insight Queue" subtitle="Portfolio risks and next actions." />
          <div className="body">
            <InsightList items={insightItems} />
          </div>
        </Panel>
      </div>
    </section>
  )
}
