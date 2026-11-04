import { describe, expect, it } from 'vitest'
import { ANALYSIS_PIPELINE, ANALYSIS_PIPELINE_SUMMARY } from '../analysisPipeline'

describe('public analysis pipeline', () => {
  it('matches the eight-stage backend trace in order', () => {
    expect(ANALYSIS_PIPELINE.map(({ label }) => label)).toEqual([
      'Ticker Intake Agent',
      'Market Data Tool',
      'Stock Forecast Agent',
      'Parameter Estimation Agent',
      'Backtest Agent',
      'Portfolio Agent',
      'Memo Writer',
      'Compliance Agent',
    ])
  })

  it('derives public summary copy from every stage', () => {
    expect(ANALYSIS_PIPELINE).toHaveLength(8)
    expect(ANALYSIS_PIPELINE_SUMMARY).toBe(
      'intake, market data, forecast, parameter estimation, backtest, portfolio, AI memo, compliance',
    )
  })
})
