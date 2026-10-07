/**
 * Display formatters (ticket 08).
 *
 * Pure functions, no React. Conventions:
 * - Missing or non-finite input renders as `MISSING` ("—"), never "NaN" or "null".
 * - Percentages are already in percent units: `1.24` means 1.24%, not 124%.
 * - Negative values use an ASCII hyphen-minus, as in the DESIGN.md preview.
 * - A value that rounds to zero at the displayed precision never shows a sign
 *   ("-0.00%" and "+0.00%" both become "0.00%").
 * - Dates are shown in Malaysia time (MYT, Asia/Kuala_Lumpur), day-first:
 *   "14 Oct 2026". Date-only strings ("2026-10-14") are calendar dates and are
 *   never shifted by a timezone.
 *
 * Numbers rendered from these functions belong in a `num` (mono, tabular) element.
 */

/** Placeholder for a value that is absent or not a finite number. */
export const MISSING = '—'

/** P/E is null when trailing EPS <= 0 (free-tier spec 01/02). */
export const LOSS_MAKING_PE = 'N/A (loss-making)'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

const MYT = 'Asia/Kuala_Lumpur'

type Maybe<T> = T | null | undefined

function isNum(value: Maybe<number>): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

const groupers = new Map<number, Intl.NumberFormat>()

/** Grouped number with a fixed number of decimals (en-MY: "1,234.50"). */
function grouped(abs: number, decimals: number): string {
  let nf = groupers.get(decimals)
  if (!nf) {
    nf = new Intl.NumberFormat('en-MY', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    groupers.set(decimals, nf)
  }
  return nf.format(abs)
}

/** True when `value` would display as zero at `decimals` places. */
function roundsToZero(value: number, decimals: number): boolean {
  return Number(Math.abs(value).toFixed(decimals)) === 0
}

/** '-' | '+' | '' for a value, given whether a plus sign is wanted for positives. */
function signOf(value: number, decimals: number, plus: boolean): string {
  if (roundsToZero(value, decimals)) return ''
  if (value < 0) return '-'
  return plus ? '+' : ''
}

const COMPACT_UNITS = [
  { value: 1, suffix: '' },
  { value: 1e3, suffix: 'K' },
  { value: 1e6, suffix: 'M' },
  { value: 1e9, suffix: 'B' },
  { value: 1e12, suffix: 'T' },
] as const

/**
 * Compact magnitude without sign: 1_234_567 -> "1.2M". Trailing zeros are
 * trimmed ("2B", not "2.0B"). Rounding up to 1000 promotes to the next unit
 * (999_960 -> "1M", not "1000K").
 */
function compactAbs(abs: number, decimals: number): string {
  const round = (n: number) => Number(n.toFixed(decimals))
  let i = COMPACT_UNITS.length - 1
  while (i > 0 && abs < COMPACT_UNITS[i].value) i--
  let scaled = round(abs / COMPACT_UNITS[i].value)
  if (scaled >= 1000 && i < COMPACT_UNITS.length - 1) {
    i++
    scaled = round(abs / COMPACT_UNITS[i].value)
  }
  return `${scaled}${COMPACT_UNITS[i].suffix}`
}

export interface RmOptions {
  /** Decimal places. Default 2; use 3 for Bursa share prices. Ignored when `compact`. */
  decimals?: number
  /** Compact magnitude: "RM 1.2B". Use for market cap and turnover. */
  compact?: boolean
  /** Show "+" on positive amounts (for absolute price changes). */
  signed?: boolean
}

/** Ringgit amount: `formatRm(1234.5)` -> "RM 1,234.50"; negatives -> "-RM 12.00". */
export function formatRm(value: Maybe<number>, options: RmOptions = {}): string {
  if (!isNum(value)) return MISSING
  const { decimals = 2, compact = false, signed = false } = options
  const sign = signOf(value, compact ? 1 : decimals, signed)
  const body = compact ? compactAbs(Math.abs(value), 1) : grouped(Math.abs(value), decimals)
  return `${sign}RM ${body}`
}

export interface PercentOptions {
  /** Decimal places. Default 2. */
  decimals?: number
  /** Show "+" on positive values. */
  signed?: boolean
}

/** Percentage from percent units: `formatPercent(1.236)` -> "1.24%". */
export function formatPercent(value: Maybe<number>, options: PercentOptions = {}): string {
  if (!isNum(value)) return MISSING
  const { decimals = 2, signed = false } = options
  return `${signOf(value, decimals, signed)}${grouped(Math.abs(value), decimals)}%`
}

export interface NumberOptions {
  /** Decimal places. Default 2. */
  decimals?: number
  /** Show "+" on positive values. */
  signed?: boolean
}

/** Plain grouped number with optional sign: index levels, points changes. */
export function formatNumber(value: Maybe<number>, options: NumberOptions = {}): string {
  if (!isNum(value)) return MISSING
  const { decimals = 2, signed = false } = options
  return `${signOf(value, decimals, signed)}${grouped(Math.abs(value), decimals)}`
}

/** Traded volume in shares, whole units with grouping: "12,480,300". */
export function formatVolume(value: Maybe<number>): string {
  if (!isNum(value)) return MISSING
  return `${signOf(value, 0, false)}${grouped(Math.abs(value), 0)}`
}

/**
 * Compact plain number: 1_234_567 -> "1.2M", 950 -> "950".
 * For currency use `formatRm(v, { compact: true })`.
 */
export function formatCompact(value: Maybe<number>, decimals = 1): string {
  if (!isNum(value)) return MISSING
  return `${signOf(value, decimals, false)}${compactAbs(Math.abs(value), decimals)}`
}

/**
 * Price-to-earnings ratio. `null` means the company is loss-making (TTM EPS <= 0)
 * and shows "N/A (loss-making)". A non-positive number is treated the same way,
 * because a negative P/E is never displayed. `undefined` (not loaded) shows "—".
 */
export function formatPe(value: Maybe<number>, decimals = 1): string {
  if (value === null) return LOSS_MAKING_PE
  if (!isNum(value)) return MISSING
  if (value <= 0) return LOSS_MAKING_PE
  return `${grouped(value, decimals)}x`
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

interface Ymd {
  year: number
  month: number // 1-12
  day: number
}

function parseDateOnly(input: string): Ymd | null {
  const m = DATE_ONLY.exec(input)
  if (!m) return null
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const check = new Date(Date.UTC(year, month - 1, day))
  const valid = check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
  return valid ? { year, month, day } : null
}

const mytParts = new Intl.DateTimeFormat('en-US', {
  timeZone: MYT,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

interface MytStamp extends Ymd {
  hour: string
  minute: string
}

function toMyt(date: Date): MytStamp | null {
  if (Number.isNaN(date.getTime())) return null
  const parts = mytParts.formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: get('hour').padStart(2, '0'),
    minute: get('minute').padStart(2, '0'),
  }
}

function dayMonthYear({ year, month, day }: Ymd): string {
  return `${day} ${MONTHS[month - 1]} ${year}`
}

/**
 * Date in MYT, day-first: "14 Oct 2026". Accepts a date-only string (calendar
 * date, no timezone shift), an ISO timestamp, or a Date.
 */
export function formatDate(input: Maybe<string | Date>): string {
  if (input === null || input === undefined || input === '') return MISSING
  if (typeof input === 'string') {
    const ymd = parseDateOnly(input)
    if (ymd) return dayMonthYear(ymd)
    if (DATE_ONLY.test(input)) return MISSING // well-formed but not a real day
  }
  const stamp = toMyt(typeof input === 'string' ? new Date(input) : input)
  return stamp ? dayMonthYear(stamp) : MISSING
}

/**
 * Timestamp in MYT: "14 Oct 2026 16:05 MYT". Date-only strings have no time,
 * so they fall back to `formatDate`.
 */
export function formatDateTime(input: Maybe<string | Date>): string {
  if (input === null || input === undefined || input === '') return MISSING
  if (typeof input === 'string' && DATE_ONLY.test(input)) return formatDate(input)
  const stamp = toMyt(typeof input === 'string' ? new Date(input) : input)
  return stamp ? `${dayMonthYear(stamp)} ${stamp.hour}:${stamp.minute} MYT` : MISSING
}
