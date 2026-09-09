import type {
  AssetClass,
  Holding,
  HoldingSource,
  HoldingType,
  PortfolioTransaction,
  TransactionType,
  ValuationSnapshot,
} from '../../types'
import { normalizeHolding, normalizeHoldings } from '../holdings'

export interface PortfolioImportResult {
  holdings: Holding[]
  transactions: PortfolioTransaction[]
  valuations: ValuationSnapshot[]
  errors: string[]
}

export const PORTFOLIO_CSV_TEMPLATE = `record_type,holding_id,date,transaction_type,symbol,name,holding_type,asset,sector,quantity,price,current_price,average_cost,cost_basis,amount,market_value,portfolio_value,benchmark_symbol,benchmark_value,price_as_of,price_source,source,description
holding,portfolio-aapl,,,AAPL,Apple Inc.,stock,us_equity,technology,20,,250,190,3800,,5000,,,,2026-08-08,csv,imported,
transaction,,2026-01-02,deposit,,,,,,,,,,,10000,,,,,,,imported,Initial contribution
snapshot,,2026-01-02,,,,,,,,,,,,,,10000,VOO,100,,,imported,
snapshot,,2026-08-08,,,,,,,,,,,,,,10850,VOO,106.5,,,imported,
`

const TRANSACTION_TYPES = new Set<TransactionType>([
  'deposit',
  'withdrawal',
  'buy',
  'sell',
  'dividend',
  'fee',
])
const HOLDING_TYPES = new Set<HoldingType>(['stock', 'etf', 'cash'])
const ASSET_CLASSES = new Set<AssetClass>([
  'us_equity',
  'intl_equity',
  'bonds',
  'cash',
  'alternatives',
  'crypto',
  'other',
])
const HOLDING_SOURCES = new Set<HoldingSource>([
  'manual',
  'demo',
  'imported',
  'plaid',
  'analysis',
])

function rowsFromCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      row.push(cell.trim())
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell.trim())
      cell = ''
      if (row.some(Boolean)) rows.push(row)
      row = []
    } else {
      cell += char
    }
  }
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

const headerKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

const numberValue = (value?: string): number | null => {
  if (!value) return null
  const parsed = Number(value.replace(/[$,%]/g, '').replace(/\s/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

const validDate = (value?: string): value is string => {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1) return false

  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    !Number.isNaN(parsed.getTime())
    && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day
  )
}

const validPriceAsOf = (value?: string): value is string => validDate(value)

const rowId = (line: number, ...parts: Array<string | undefined>): string =>
  `csv-${line}-${parts.filter(Boolean).join('-').replace(/[^a-z0-9-]/gi, '').toLowerCase()}`

export function parsePortfolioCsv(text: string): PortfolioImportResult {
  const rows = rowsFromCsv(text)
  const result: PortfolioImportResult = { holdings: [], transactions: [], valuations: [], errors: [] }
  if (rows.length < 2) {
    result.errors.push('The CSV needs a header and at least one data row.')
    return result
  }
  const headers = rows[0].map(headerKey)

  rows.slice(1).forEach((cells, rowIndex) => {
    const line = rowIndex + 2
    const record = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))
    const transactionType = (record.transaction_type || record.activity_type || record.type || '').toLowerCase()
    const explicitKind = (record.record_type || record.record || record.kind || '').toLowerCase()
    const kind = explicitKind ||
      (record.portfolio_value || record.account_value
        ? 'snapshot'
        : validDate(record.date) && TRANSACTION_TYPES.has(transactionType as TransactionType)
          ? 'transaction'
          : 'holding')

    if (kind === 'holding') {
      const symbol = (record.symbol || record.ticker || '').toUpperCase()
      const quantity = numberValue(record.quantity || record.shares)
      const currentPrice = numberValue(record.current_price || record.market_price || record.price)
      const averageCost = numberValue(record.average_cost || record.avg_cost || record.purchase_price)
      const costBasis = numberValue(record.cost_basis || record.total_cost)
      const explicitValue = numberValue(record.value || record.market_value || record.amount)
      const value = explicitValue ?? (
        quantity != null && currentPrice != null ? quantity * currentPrice : null
      )
      if (!symbol || value == null || value < 0) {
        result.errors.push(`Line ${line}: a holding needs a symbol and non-negative value.`)
        return
      }
      if (
        [quantity, currentPrice, averageCost, costBasis]
          .some((item) => item != null && item < 0)
      ) {
        result.errors.push(`Line ${line}: holding quantity, prices, and cost basis cannot be negative.`)
        return
      }
      if (record.current_price || record.market_price || record.price) {
        if (currentPrice == null || currentPrice <= 0) {
          result.errors.push(`Line ${line}: current price must be greater than zero.`)
          return
        }
      }
      if (averageCost != null && !(quantity != null && quantity > 0)) {
        result.errors.push(`Line ${line}: average_cost requires a positive quantity.`)
        return
      }
      if (
        quantity != null
        && quantity > 0
        && averageCost != null
        && costBasis != null
        && Math.abs(costBasis - quantity * averageCost)
          > Math.max(0.02, Math.abs(quantity * averageCost) * 1e-6)
      ) {
        result.errors.push(`Line ${line}: cost_basis must equal quantity multiplied by average_cost.`)
        return
      }
      const priceAsOf = record.price_as_of || record.quote_as_of || ''
      if (priceAsOf && !validPriceAsOf(priceAsOf)) {
        result.errors.push(`Line ${line}: price_as_of must be a valid YYYY-MM-DD date.`)
        return
      }
      if (priceAsOf && currentPrice == null) {
        result.errors.push(`Line ${line}: price_as_of requires a current price.`)
        return
      }
      const holdingId = (record.holding_id || record.position_id || record.id || '').trim()
      if (holdingId.length > 64) {
        result.errors.push(`Line ${line}: holding_id cannot exceed 64 characters.`)
        return
      }
      const priceSource = (record.price_source || record.quote_source || '').trim()
      if (priceSource.length > 64) {
        result.errors.push(`Line ${line}: price_source cannot exceed 64 characters.`)
        return
      }
      const rawType = (record.holding_type || record.security_type || record.type || 'stock').toLowerCase()
      const type = HOLDING_TYPES.has(rawType as HoldingType) ? (rawType as HoldingType) : 'stock'
      const rawAsset = (record.asset || record.asset_class || (type === 'cash' ? 'cash' : 'us_equity'))
        .toLowerCase()
        .replace(/\s+/g, '_')
      const asset = ASSET_CLASSES.has(rawAsset as AssetClass) ? (rawAsset as AssetClass) : 'other'
      const rawSource = (record.source || 'imported').toLowerCase() as HoldingSource
      result.holdings.push(normalizeHolding({
        id: holdingId || rowId(line, symbol, 'holding'),
        symbol,
        name: record.name || symbol,
        type,
        asset,
        sector: record.sector || (type === 'cash' ? 'cash' : 'unknown'),
        value,
        source: HOLDING_SOURCES.has(rawSource) ? rawSource : 'imported',
        quantity,
        currentPrice,
        averageCost,
        costBasis,
        priceAsOf: priceAsOf || null,
        priceSource: priceSource || (currentPrice == null ? null : 'csv'),
      }, 'imported'))
      return
    }

    if (kind === 'transaction' || kind === 'activity') {
      const type = transactionType as TransactionType
      const holdingId = (record.holding_id || record.position_id || '').trim()
      const quantity = numberValue(record.quantity)
      const price = numberValue(record.price)
      const explicitAmount = numberValue(record.amount || record.value)
      const amount = explicitAmount ?? (quantity != null && price != null ? quantity * price : null)
      if (!validDate(record.date) || !TRANSACTION_TYPES.has(type) || amount == null || amount < 0) {
        result.errors.push(`Line ${line}: activity needs YYYY-MM-DD date, a supported type, and amount.`)
        return
      }
      if (holdingId.length > 64) {
        result.errors.push(`Line ${line}: holding_id cannot exceed 64 characters.`)
        return
      }
      const symbol = (record.symbol || record.ticker || '').toUpperCase() || null
      result.transactions.push({
        id: rowId(line, record.date, type, symbol ?? undefined),
        holdingId: holdingId || null,
        date: record.date,
        type,
        symbol,
        quantity,
        price,
        amount,
        description: record.description || record.note || '',
        source: 'imported',
      })
      return
    }

    if (kind === 'snapshot' || kind === 'valuation') {
      const value = numberValue(record.portfolio_value || record.account_value || record.value)
      const benchmarkValue = numberValue(record.benchmark_value || record.index_value)
      if (!validDate(record.date) || value == null || value < 0) {
        result.errors.push(`Line ${line}: a snapshot needs YYYY-MM-DD date and portfolio_value.`)
        return
      }
      result.valuations.push({
        id: rowId(line, record.date, 'snapshot'),
        date: record.date,
        value,
        benchmarkSymbol: (record.benchmark_symbol || record.benchmark || 'VOO').toUpperCase(),
        benchmarkValue,
        source: 'imported',
      })
      return
    }

    result.errors.push(`Line ${line}: record_type must be holding, transaction, or snapshot.`)
  })

  result.holdings = normalizeHoldings(result.holdings, 'imported')

  return result
}
