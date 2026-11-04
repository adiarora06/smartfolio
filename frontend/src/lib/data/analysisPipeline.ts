// Public description of the stock-analysis trace emitted by the backend.
// UI surfaces derive their stage count and copy from this single source so the
// landing page and Open Source screen cannot silently drift apart.

export type AnalysisStageKind = 'agent' | 'tool' | 'guard'

export interface AnalysisPipelineStage {
  label: string
  shortLabel: string
  role: string
  flow: string
  kind: AnalysisStageKind
}

export const ANALYSIS_PIPELINE: readonly AnalysisPipelineStage[] = [
  {
    label: 'Ticker Intake Agent',
    shortLabel: 'intake',
    role: 'Normalizes the symbol and clamps the horizon to 7–365 days.',
    flow: 'Ticker Intake normalizes the symbol and clamps the horizon.',
    kind: 'agent',
  },
  {
    label: 'Market Data Tool',
    shortLabel: 'market data',
    role: 'Resolves the live price (Finnhub / Alpha Vantage) with an offline reference backstop.',
    flow: 'Market Data Tool resolves the price (live provider or offline reference).',
    kind: 'tool',
  },
  {
    label: 'Stock Forecast Agent',
    shortLabel: 'forecast',
    role: 'Builds bear / median / bull paths with a confidence score.',
    flow: 'Stock Forecast Agent creates median, bear, and bull paths.',
    kind: 'agent',
  },
  {
    label: 'Parameter Estimation Agent',
    shortLabel: 'parameter estimation',
    role: 'Reports the volatility and shrunk drift inputs that shape the forecast cone.',
    flow: 'Parameter Estimation Agent records the fitted volatility and drift inputs.',
    kind: 'agent',
  },
  {
    label: 'Backtest Agent',
    shortLabel: 'backtest',
    role: 'Evaluates sample windows: hit rate, mean error, drawdown proxy.',
    flow: 'Backtest Agent evaluates sample windows.',
    kind: 'agent',
  },
  {
    label: 'Portfolio Agent',
    shortLabel: 'portfolio',
    role: 'Runs the what-if: how the position would shift portfolio weight and sector concentration.',
    flow: 'Portfolio Agent checks concentration against your holdings.',
    kind: 'agent',
  },
  {
    label: 'Memo Writer',
    shortLabel: 'AI memo',
    role: 'AI explanation layer — narrates the memo via LLM (gpt-4o-mini) or a deterministic template.',
    flow: 'Memo Writer narrates the result (LLM when configured, template otherwise).',
    kind: 'agent',
  },
  {
    label: 'Compliance Agent',
    shortLabel: 'compliance',
    role: 'Validates every output as educational — no advice, no guarantees; serves the template if narration fails.',
    flow: 'Compliance Agent frames the output as educational analysis.',
    kind: 'guard',
  },
]

export const ANALYSIS_PIPELINE_SUMMARY = ANALYSIS_PIPELINE.map(
  ({ shortLabel }) => shortLabel,
).join(', ')
