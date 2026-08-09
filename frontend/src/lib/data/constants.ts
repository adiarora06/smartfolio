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
  PortfolioTransaction,
  RiskProfileName,
  ValuationSnapshot,
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

/** Dated demo history keeps the performance foundation inspectable without
 * claiming that today's holdings can recreate a real historical account. */
export const demoTransactions = (): PortfolioTransaction[] => [
  {
    id: 'demo-deposit-2025-01-02',
    date: '2025-01-02',
    type: 'deposit',
    amount: 18000,
    description: 'Initial portfolio funding',
    source: 'demo',
  },
  {
    id: 'demo-buy-aapl-2025-01-03',
    date: '2025-01-03',
    type: 'buy',
    symbol: 'AAPL',
    quantity: 20,
    price: 200,
    amount: 4000,
    description: 'Initial AAPL position',
    source: 'demo',
  },
  {
    id: 'demo-deposit-2025-04-01',
    date: '2025-04-01',
    type: 'deposit',
    amount: 2000,
    description: 'Quarterly contribution',
    source: 'demo',
  },
  {
    id: 'demo-dividend-2025-06-14',
    date: '2025-06-14',
    type: 'dividend',
    symbol: 'AAPL',
    amount: 120,
    description: 'Cash dividend',
    source: 'demo',
  },
  {
    id: 'demo-deposit-2025-07-01',
    date: '2025-07-01',
    type: 'deposit',
    amount: 2000,
    description: 'Quarterly contribution',
    source: 'demo',
  },
  {
    id: 'demo-dividend-2025-12-15',
    date: '2025-12-15',
    type: 'dividend',
    symbol: 'VOO',
    amount: 160,
    description: 'ETF distribution',
    source: 'demo',
  },
]

export const demoValuations = (): ValuationSnapshot[] => [
  { id: 'demo-value-2025-01-02', date: '2025-01-02', value: 18000, benchmarkSymbol: 'VOO', benchmarkValue: 100, source: 'demo' },
  { id: 'demo-value-2025-04-01', date: '2025-04-01', value: 20500, benchmarkSymbol: 'VOO', benchmarkValue: 102.2, source: 'demo' },
  { id: 'demo-value-2025-07-01', date: '2025-07-01', value: 22900, benchmarkSymbol: 'VOO', benchmarkValue: 105.4, source: 'demo' },
  { id: 'demo-value-2025-10-01', date: '2025-10-01', value: 21900, benchmarkSymbol: 'VOO', benchmarkValue: 109.1, source: 'demo' },
  { id: 'demo-value-2026-01-02', date: '2026-01-02', value: 24600, benchmarkSymbol: 'VOO', benchmarkValue: 111.8, source: 'demo' },
  { id: 'demo-value-2026-08-08', date: '2026-08-08', value: 25000, benchmarkSymbol: 'VOO', benchmarkValue: 115.6, source: 'demo' },
]

type ConnectionTuple = [name: string, type: string, on: boolean]

// Planned-integration demo toggles. Plaid, CSV import, and the A2A agent card
// are NOT here — they are real integrations with dedicated cards.
const CONNECTION_TUPLES: ConnectionTuple[] = [
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
