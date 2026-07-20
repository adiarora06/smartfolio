// Static data for SmartFolio — ported verbatim from the prototype.
// Values here are deterministic inputs (target allocations, assumed returns,
// demo holdings, and the offline stock reference table).

import type {
  AllocationMap,
  ChatMessage,
  Connection,
  Goal,
  Holding,
  InvestorProfile,
  RiskProfileName,
} from '../../types'

/** Target allocation by risk profile. */
export const TARGETS: Record<RiskProfileName, AllocationMap> = {
  conservative: { us_equity: 0.3, intl_equity: 0.1, bonds: 0.45, cash: 0.1, alternatives: 0.05 },
  balanced: { us_equity: 0.45, intl_equity: 0.2, bonds: 0.25, cash: 0.25, alternatives: 0.05 },
  growth: { us_equity: 0.6, intl_equity: 0.25, bonds: 0.1, cash: 0.03, alternatives: 0.02 },
  aggressive: { us_equity: 0.7, intl_equity: 0.22, bonds: 0.03, cash: 0.02, alternatives: 0.03 },
}

/** Assumed annual return by asset class (decimal). */
export const RETURNS: AllocationMap = {
  us_equity: 0.18,
  intl_equity: 0.12,
  bonds: 0.05,
  cash: 0.045,
  alternatives: 0.08,
  crypto: 0.22,
  other: 0,
}

export const DEFAULT_PROFILE: InvestorProfile = {
  age: 28,
  income: 90000,
  contribution: 750,
  horizon: 30,
  risk: 4,
  emergency: 4,
  goal: 'long_term_growth',
  liquidity: 'medium',
}

type DemoHoldingTuple = [
  symbol: string,
  name: string,
  type: Holding['type'],
  asset: Holding['asset'],
  sector: string,
  value: number,
]

const DEMO_HOLDING_TUPLES: DemoHoldingTuple[] = [
  ['AAPL', 'Apple Inc.', 'stock', 'us_equity', 'technology', 5000],
  ['NVDA', 'NVIDIA Corp.', 'stock', 'us_equity', 'technology', 5500],
  ['TSLA', 'Tesla Inc.', 'stock', 'us_equity', 'consumer_cyclical', 3500],
  ['VOO', 'Vanguard S&P 500 ETF', 'etf', 'us_equity', 'broad_market', 7000],
  ['VXUS', 'Vanguard Total International Stock ETF', 'etf', 'intl_equity', 'broad_market', 1500],
  ['CASH', 'Cash', 'cash', 'cash', 'cash', 2500],
]

/** A fresh copy of the demo portfolio (never share the array reference). */
export const demoHoldings = (): Holding[] =>
  DEMO_HOLDING_TUPLES.map(([symbol, name, type, asset, sector, value]) => ({
    symbol,
    name,
    type,
    asset,
    sector,
    value,
  }))

type ConnectionTuple = [name: string, type: string, on: boolean]

// Planned-integration demo toggles. Plaid and the A2A agent card are NOT
// here — they are real integrations with dedicated cards in ConnectionsScreen.
const CONNECTION_TUPLES: ConnectionTuple[] = [
  ['Broker CSV Import', 'File import', true],
  ['Market Data API', 'Prices and fundamentals', true],
  ['Stock Forecast Engine', 'Ticker analysis', true],
  ['MCP Tool Server', 'AI tools', false],
]

export const defaultConnections = (): Connection[] =>
  CONNECTION_TUPLES.map(([name, type, on]) => ({ name, type, on }))

export const initialChat = (): ChatMessage[] => [
  {
    role: 'ai',
    text: 'I can help with portfolio risk, rebalancing, connected data, and OpenVC-style stock analysis.',
  },
]

/** Onboarding steps: [title, description]. */
export const SETUP_STEPS: Array<[string, string]> = [
  ['Profile', 'Basic financial context'],
  ['Goals', 'Risk and liquidity posture'],
  ['Connect', 'Choose data sources'],
  ['Review', 'Open SmartFolio demo'],
]

export const SETUP_TITLES: string[] = [
  'Create your investor profile',
  'Set goals and risk posture',
  'Connect data sources',
  'Review and open demo',
]

export const SETUP_COPY: string[] = [
  'SmartFolio starts with context before it analyzes investments.',
  'Risk capacity and goals shape the target allocation.',
  'Choose where portfolio and market data will come from.',
  'You can now open the SmartFolio demo experience.',
]

export const GOALS: Array<[Goal, string]> = [
  ['long_term_growth', 'Long-term growth'],
  ['retirement', 'Retirement'],
  ['income', 'Income'],
]

type StockBaseTuple = [
  name: string,
  sector: string,
  price: number,
  vol: number,
  trend: number,
  quality: number,
]

/** Offline reference quotes for the stock forecast engine. */
export const STOCK_BASE: Record<string, StockBaseTuple> = {
  AAPL: ['Apple Inc.', 'technology', 215, 0.24, 0.07, 0.82],
  MSFT: ['Microsoft Corp.', 'technology', 448, 0.22, 0.08, 0.88],
  NVDA: ['NVIDIA Corp.', 'technology', 132, 0.42, 0.14, 0.78],
  TSLA: ['Tesla Inc.', 'consumer_cyclical', 248, 0.48, 0.05, 0.58],
  AMZN: ['Amazon.com Inc.', 'consumer_cyclical', 193, 0.31, 0.09, 0.74],
  GOOGL: ['Alphabet Inc.', 'communication_services', 181, 0.28, 0.08, 0.8],
  JPM: ['JPMorgan Chase & Co.', 'financial_services', 214, 0.25, 0.04, 0.76],
  VOO: ['Vanguard S&P 500 ETF', 'broad_market', 510, 0.17, 0.06, 0.9],
}
