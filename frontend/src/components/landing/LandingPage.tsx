// Public landing page: hero, live-preview card, and feature grid.

import { useStore } from '../../store/useStore'
import { SkipToDemoButton } from '../layout/SkipToDemoButton'

const FEATURES: Array<[string, string]> = [
  ['Guided setup', 'Collects user age, income, risk tolerance, goals, and liquidity needs.'],
  ['Portfolio intelligence', 'Shows allocation gaps, concentration risks, and target allocation paths.'],
  ['Analyze Stock', 'OpenVC-style terminal with forecast, backtest, topology, audit log, and memory.'],
  ['Connected apps', 'Designed for brokerages, CSV imports, market data APIs, MCP tools, and A2A agents.'],
]

const PROOF: Array<[string, string]> = [
  ['7 agents', 'Profile, risk, portfolio, forecast, backtest, recommendation, compliance'],
  ['5 modules', 'Setup, portfolio, Analyze Stock, scenarios, advisor, connections'],
  ['0 advice', 'Educational analysis with deterministic calculations'],
]

export function LandingPage() {
  const goToPage = useStore((s) => s.goToPage)
  return (
    <section className="page active" id="landing">
      <div className="hero">
        <div>
          <span className="eyebrow">
            <span className="dot" /> Public beta prototype
          </span>
          <h1>AI portfolio management with a built-in stock analysis terminal.</h1>
          <p>
            SmartFolio helps users set up an investor profile, understand diversification, run
            scenario simulations, connect financial data, and analyze individual stocks through an
            OpenVC-style workflow.
          </p>
          <div className="actions">
            <button className="primary" onClick={() => goToPage('setup')}>
              Start Guided Setup
            </button>
            <SkipToDemoButton />
          </div>
          <div className="proof">
            {PROOF.map(([head, sub]) => (
              <div key={head}>
                <strong>{head}</strong>
                <span>{sub}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="preview">
          <div className="previewTop">
            <strong>Analyze Stock</strong>
            <span className="pill">
              <span className="dot" />
              READY
            </span>
          </div>
          <div className="miniMetrics">
            <div className="mini">
              <span>Ticker</span>
              <strong>AAPL</strong>
            </div>
            <div className="mini">
              <span>Target</span>
              <strong>$220</strong>
            </div>
            <div className="mini">
              <span>Signal</span>
              <strong>Neutral</strong>
            </div>
          </div>
          <div className="chart">
            <svg width="100%" height="130" viewBox="0 0 600 130">
              <polyline
                points="20,85 90,72 160,78 230,55 300,62 370,38 450,45 560,24"
                fill="none"
                stroke="#5eead4"
                strokeWidth="5"
              />
              <polyline
                points="20,100 90,88 160,90 230,75 300,82 370,65 450,72 560,58"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2"
                strokeDasharray="5 5"
              />
              <polyline
                points="20,65 90,55 160,58 230,38 300,42 370,20 450,28 560,10"
                fill="none"
                stroke="#60a5fa"
                strokeWidth="2"
                strokeDasharray="5 5"
              />
            </svg>
          </div>
          <ul className="list termList">
            <li>Forecast Agent creates bear, median, and bull paths.</li>
            <li>Backtest Agent checks sample directional accuracy.</li>
            <li>Portfolio Agent checks whether the stock increases concentration.</li>
          </ul>
        </div>
      </div>
      <div className="features">
        {FEATURES.map(([head, sub]) => (
          <div className="feature" key={head}>
            <strong>{head}</strong>
            <span>{sub}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
