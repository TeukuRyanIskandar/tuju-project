import type { ComponentProps } from 'react'
import { cn } from '#/lib/utils'

/**
 * Dense data table (DESIGN.md "Tables"): 24px header, 26px rows, hairlines,
 * hover `surface-3`, numeric columns right-aligned in mono.
 *
 * Pass `aria-label` to name the table. A labelled table also gets a focusable
 * scroll region so keyboard users can scroll it horizontally.
 */
export function Table({ className, 'aria-label': ariaLabel, ...props }: ComponentProps<'table'>) {
  return (
    <div
      className="w-full overflow-x-auto"
      {...(ariaLabel ? { role: 'region', 'aria-label': ariaLabel, tabIndex: 0 } : {})}
    >
      <table
        aria-label={ariaLabel}
        className={cn('w-full border-separate border-spacing-0 text-body', className)}
        {...props}
      />
    </div>
  )
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={className} {...props} />
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&>tr:last-child>td]:border-b-0', className)} {...props} />
}

export interface TableRowProps extends ComponentProps<'tr'> {
  /**
   * Selected row: accent-soft fill plus a 2px accent bar on the left. Exposed as
   * `aria-current` since `aria-selected` is not valid on a plain table row.
   */
  selected?: boolean
}

export function TableRow({ className, selected = false, ...props }: TableRowProps) {
  return (
    <tr
      aria-current={selected ? 'true' : undefined}
      data-selected={selected ? '' : undefined}
      className={cn(
        'transition-colors hover:bg-surface-3',
        '[&>td:first-child]:border-l-2 [&>td:first-child]:border-l-transparent',
        'data-[selected]:bg-accent-soft data-[selected]:[&>td:first-child]:border-l-primary',
        className,
      )}
      {...props}
    />
  )
}

export interface TableCellProps {
  /** Right-align in mono tabular figures. */
  numeric?: boolean
}

export function TableHead({ className, numeric = false, ...props }: ComponentProps<'th'> & TableCellProps) {
  return (
    <th
      scope="col"
      className={cn(
        'h-6 border-b border-border bg-surface-2 px-2.5 text-left text-2xs font-medium tracking-wider whitespace-nowrap text-fg-3 uppercase',
        numeric && 'text-right',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({ className, numeric = false, ...props }: ComponentProps<'td'> & TableCellProps) {
  return (
    <td
      className={cn(
        'h-[var(--row-h)] border-b border-border px-2.5 whitespace-nowrap',
        numeric && 'num text-right',
        className,
      )}
      {...props}
    />
  )
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return <caption className={cn('sr-only', className)} {...props} />
}

/** Symbol cell content: bold mono code with the company name in `fg-3`. */
export function TableSymbol({ code, name }: { code: string; name?: string | null }) {
  return (
    <>
      <span className="font-mono text-xs font-semibold">{code}</span>
      {name ? <span className="ml-2 text-xs text-fg-3">{name}</span> : null}
    </>
  )
}
