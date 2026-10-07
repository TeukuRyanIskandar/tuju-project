import {
  LOSS_MAKING_PE,
  MISSING,
  formatCompact,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPe,
  formatPercent,
  formatRm,
  formatVolume,
} from './format'

describe('formatRm', () => {
  it('formats with grouping and two decimals', () => {
    expect(formatRm(1234.5)).toBe('RM 1,234.50')
    expect(formatRm(0)).toBe('RM 0.00')
  })
  it('supports 3-decimal share prices', () => {
    expect(formatRm(10.42, { decimals: 3 })).toBe('RM 10.420')
  })
  it('puts the minus before RM', () => {
    expect(formatRm(-12)).toBe('-RM 12.00')
  })
  it('signs positives when asked, but never a zero', () => {
    expect(formatRm(0.18, { decimals: 3, signed: true })).toBe('+RM 0.180')
    expect(formatRm(0, { signed: true })).toBe('RM 0.00')
    expect(formatRm(-0.001, { signed: true })).toBe('RM 0.00')
  })
  it('compacts large amounts', () => {
    expect(formatRm(1_234_567_890, { compact: true })).toBe('RM 1.2B')
    expect(formatRm(2_000_000, { compact: true })).toBe('RM 2M')
    expect(formatRm(-45_600, { compact: true })).toBe('-RM 45.6K')
  })
  it('renders a placeholder for missing or non-finite input', () => {
    expect(formatRm(null)).toBe(MISSING)
    expect(formatRm(undefined)).toBe(MISSING)
    expect(formatRm(Number.NaN)).toBe(MISSING)
    expect(formatRm(Infinity)).toBe(MISSING)
  })
})

describe('formatPercent', () => {
  it('formats percent units with two decimals', () => {
    expect(formatPercent(1.236)).toBe('1.24%')
    expect(formatPercent(0)).toBe('0.00%')
  })
  it('respects decimals', () => {
    expect(formatPercent(12.3456, { decimals: 1 })).toBe('12.3%')
    expect(formatPercent(5, { decimals: 0 })).toBe('5%')
  })
  it('signs on request', () => {
    expect(formatPercent(1.24, { signed: true })).toBe('+1.24%')
    expect(formatPercent(-0.87, { signed: true })).toBe('-0.87%')
    expect(formatPercent(-0.87)).toBe('-0.87%')
  })
  it('never shows a sign on a value that rounds to zero', () => {
    expect(formatPercent(0.001, { signed: true })).toBe('0.00%')
    expect(formatPercent(-0.004, { signed: true })).toBe('0.00%')
    expect(formatPercent(-0.004)).toBe('0.00%')
  })
  it('renders a placeholder for missing input', () => {
    expect(formatPercent(null)).toBe(MISSING)
    expect(formatPercent(undefined)).toBe(MISSING)
    expect(formatPercent(Number.NaN)).toBe(MISSING)
  })
})

describe('formatNumber', () => {
  it('groups and fixes decimals', () => {
    expect(formatNumber(1642.18)).toBe('1,642.18')
    expect(formatNumber(1642.1, { decimals: 3 })).toBe('1,642.100')
  })
  it('signs on request and hides sign on zero', () => {
    expect(formatNumber(0.22, { signed: true, decimals: 3 })).toBe('+0.220')
    expect(formatNumber(-0.09, { signed: true, decimals: 3 })).toBe('-0.090')
    expect(formatNumber(0, { signed: true })).toBe('0.00')
  })
  it('renders a placeholder for missing input', () => {
    expect(formatNumber(null)).toBe(MISSING)
  })
})

describe('formatVolume', () => {
  it('groups whole shares', () => {
    expect(formatVolume(12_480_300)).toBe('12,480,300')
    expect(formatVolume(0)).toBe('0')
  })
  it('rounds fractional input to whole shares', () => {
    expect(formatVolume(1234.6)).toBe('1,235')
  })
  it('renders a placeholder for missing input', () => {
    expect(formatVolume(null)).toBe(MISSING)
    expect(formatVolume(undefined)).toBe(MISSING)
  })
})

describe('formatCompact', () => {
  it.each([
    [0, '0'],
    [950, '950'],
    [1_000, '1K'],
    [1_234, '1.2K'],
    [1_234_567, '1.2M'],
    [2_000_000_000, '2B'],
    [3_450_000_000_000, '3.5T'],
    [-1_500_000, '-1.5M'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatCompact(input)).toBe(expected)
  })
  it('promotes to the next unit when rounding reaches 1000', () => {
    expect(formatCompact(999_960)).toBe('1M')
  })
  it('respects decimals', () => {
    expect(formatCompact(1_234_567, 2)).toBe('1.23M')
    expect(formatCompact(1_234_567, 0)).toBe('1M')
  })
  it('renders a placeholder for missing input', () => {
    expect(formatCompact(null)).toBe(MISSING)
    expect(formatCompact(Number.NaN)).toBe(MISSING)
  })
})

describe('formatPe', () => {
  it('shows N/A (loss-making) for null', () => {
    expect(formatPe(null)).toBe('N/A (loss-making)')
    expect(formatPe(null)).toBe(LOSS_MAKING_PE)
  })
  it('never shows a negative or zero P/E', () => {
    expect(formatPe(-5)).toBe(LOSS_MAKING_PE)
    expect(formatPe(0)).toBe(LOSS_MAKING_PE)
  })
  it('formats a positive P/E with an x suffix', () => {
    expect(formatPe(14.83)).toBe('14.8x')
    expect(formatPe(1234.5, 2)).toBe('1,234.50x')
  })
  it('treats undefined (not loaded) as missing, not loss-making', () => {
    expect(formatPe(undefined)).toBe(MISSING)
    expect(formatPe(Number.NaN)).toBe(MISSING)
  })
})

describe('formatDate', () => {
  it('formats a date-only string without shifting the day', () => {
    expect(formatDate('2026-10-14')).toBe('14 Oct 2026')
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026')
  })
  it('converts timestamps to MYT (UTC+8), rolling the day over', () => {
    expect(formatDate('2026-10-14T08:05:00Z')).toBe('14 Oct 2026')
    expect(formatDate('2026-10-14T20:00:00Z')).toBe('15 Oct 2026')
  })
  it('accepts a Date', () => {
    expect(formatDate(new Date('2026-12-31T17:00:00Z'))).toBe('1 Jan 2027')
  })
  it('renders a placeholder for missing or invalid input', () => {
    expect(formatDate(null)).toBe(MISSING)
    expect(formatDate(undefined)).toBe(MISSING)
    expect(formatDate('')).toBe(MISSING)
    expect(formatDate('not a date')).toBe(MISSING)
    expect(formatDate('2026-02-31')).toBe(MISSING)
    expect(formatDate(new Date('x'))).toBe(MISSING)
  })
})

describe('formatDateTime', () => {
  it('formats a timestamp in MYT with a 24-hour clock', () => {
    expect(formatDateTime('2026-10-14T08:05:00Z')).toBe('14 Oct 2026 16:05 MYT')
    expect(formatDateTime('2026-10-14T16:30:00Z')).toBe('15 Oct 2026 00:30 MYT')
  })
  it('falls back to the date for date-only strings', () => {
    expect(formatDateTime('2026-10-14')).toBe('14 Oct 2026')
  })
  it('renders a placeholder for missing or invalid input', () => {
    expect(formatDateTime(null)).toBe(MISSING)
    expect(formatDateTime('garbage')).toBe(MISSING)
  })
})
