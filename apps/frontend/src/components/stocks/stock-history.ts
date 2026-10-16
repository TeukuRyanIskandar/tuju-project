export type HistoryRange = '1M' | '3M' | '1Y' | '2Y'
export interface HistoryPoint { date: string; close: number | null; volume: number | null }

/** Complete decimal strings only; never parse a prefix or coerce absence to zero. */
export function stockNumber(value: unknown): number | null {
  if (typeof value === 'string') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null
    value = Number(value)
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Validate a calendar day without local timezone parsing or rollover. */
export function tradingDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

const nonnegative = (value: unknown) => {
  const number = stockNumber(value)
  return number !== null && number >= 0 ? number : null
}

/** Keep invalid quantities as gaps. Duplicate days are ambiguous, not last-write-wins. */
export function parseHistory(input: unknown): HistoryPoint[] {
  if (!Array.isArray(input)) return []
  const days = new Map<string, HistoryPoint>()
  for (const row of input) {
    if (!row || typeof row !== 'object') continue
    const date = tradingDate(row.date)
    if (!date) continue
    days.set(date, days.has(date)
      ? { date, close: null, volume: null }
      : { date, close: nonnegative(row.close), volume: nonnegative(row.volume) })
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Inclusive calendar window anchored to latest stored day, not the browser clock. */
export function historyWindow(points: readonly HistoryPoint[], range: HistoryRange): HistoryPoint[] {
  const latest = points.at(-1)?.date
  if (!latest) return []
  const [year, month, day] = latest.split('-').map(Number)
  const months = { '1M': 1, '3M': 3, '1Y': 12, '2Y': 24 }[range]
  const first = new Date(`${latest}T00:00:00Z`)
  first.setUTCDate(1)
  first.setUTCFullYear(year, month - 1 - months)
  const lastDay = new Date(first.getTime())
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0)
  first.setUTCDate(Math.min(day, lastDay.getUTCDate()))
  const start = first.toISOString().slice(0, 10)
  return points.filter(point => point.date >= start && point.date <= latest)
}
