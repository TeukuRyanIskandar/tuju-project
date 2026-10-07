import { cn } from '#/lib/utils'
import { formatNumber, formatPercent } from '#/lib/format'

export type ChangeDirection = 'up' | 'down' | 'unch'

/** Direction at the displayed precision: +0.001 shown as "0.00%" is unchanged. */
export function changeDirection(value: number, decimals: number): ChangeDirection {
  const rounded = Number(value.toFixed(decimals))
  if (rounded > 0) return 'up'
  if (rounded < 0) return 'down'
  return 'unch'
}

const STYLE: Record<ChangeDirection, { arrow: string; word: string; className: string }> = {
  up: { arrow: '▲', word: 'Up', className: 'bg-up-bg text-up' },
  down: { arrow: '▼', word: 'Down', className: 'bg-down-bg text-down' },
  unch: { arrow: '▬', word: 'Unchanged', className: 'bg-unch-bg text-unch' },
}

export interface ChangeChipProps {
  /** The movement. For `unit="percent"` this is in percent units (1.24 = 1.24%). */
  value: number | null | undefined
  /** Decimal places. Default 2. */
  decimals?: number
  /** `percent` appends "%"; `none` is a plain signed number (index points, price change). */
  unit?: 'percent' | 'none'
  className?: string
}

/**
 * Price or index movement, e.g. `▲ +1.24%`. Carries a sign and an arrow so
 * colour is never the only signal (DESIGN.md principle 6), plus a screen-reader
 * word because the arrow glyph is decorative. Only for price and index movement;
 * volume and other counts are plain text.
 */
export function ChangeChip({ value, decimals = 2, unit = 'percent', className }: ChangeChipProps) {
  const base =
    'num inline-flex h-[18px] items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap'

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return (
      <span data-direction="none" className={cn(base, 'bg-unch-bg text-unch', className)}>
        <span className="sr-only">No change data</span>
        <span aria-hidden="true">—</span>
      </span>
    )
  }

  const direction = changeDirection(value, decimals)
  const { arrow, word, className: tone } = STYLE[direction]
  const text =
    unit === 'percent'
      ? formatPercent(value, { decimals, signed: true })
      : formatNumber(value, { decimals, signed: true })

  return (
    <span data-direction={direction} className={cn(base, tone, className)}>
      <span className="sr-only">{word}</span>
      <span aria-hidden="true">{arrow}</span>
      <span>{text}</span>
    </span>
  )
}
