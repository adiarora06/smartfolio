import { describe, expect, it } from 'vitest'
import { analyzePortfolio } from '../../calculations/portfolio'
import { analyzeStock } from '../../calculations/stock'
import { DEFAULT_PROFILE, demoHoldings } from '../../data/constants'
import { answerAdvisor } from '../advisor'

describe('context-aware advisor fallback', () => {
  it('grounds an allocation answer in the recommendation that opened the assistant', () => {
    const summary = 'Bonds are 0.0% of the portfolio versus a 10.0% target.'
    const answer = answerAdvisor('How can I rebalance to close this gap?', {
      analysis: analyzePortfolio(demoHoldings(), DEFAULT_PROFILE),
      stock: analyzeStock('AAPL', 30),
      sourceContext: {
        origin: 'overview',
        kind: 'allocation_gap',
        title: 'Bonds allocation gap',
        summary,
        suggestedQuestion: 'How can I close this gap gradually?',
        facts: { Current: '0.0%', Target: '10.0%' },
      },
    })

    expect(answer).toContain(summary)
    expect(answer).toContain('future contributions')
  })
})
