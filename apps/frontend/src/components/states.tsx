import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

export interface LoadingStateProps {
  /** Visible and announced text. Default "Loading…". */
  label?: string
  className?: string
}

/** Loading indicator with a text label; the spinner is decorative. */
export function LoadingState({ label = 'Loading…', className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex items-center justify-center gap-2 px-3 py-6 text-body text-fg-3', className)}
    >
      <span
        aria-hidden="true"
        className="size-3.5 animate-spin rounded-full border-2 border-border-strong border-t-fg-2"
      />
      <span>{label}</span>
    </div>
  )
}

export interface EmptyStateProps {
  title: string
  description?: ReactNode
  /** Optional call to action, e.g. a reset-filters button. */
  action?: ReactNode
  className?: string
}

/** "Nothing here" state. Not an error: no alert role, no danger colour. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-1 px-3 py-6 text-center', className)}>
      <p className="m-0 text-body font-semibold text-fg-2">{title}</p>
      {description ? <p className="m-0 max-w-prose text-xs text-fg-3">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export interface ErrorStateProps {
  /** Bold label. Default "Something went wrong". */
  title?: string
  message?: ReactNode
  /** When set, renders a "Try again" button. */
  onRetry?: () => void
  className?: string
}

/**
 * Alert pattern from DESIGN.md: `surface-1`, 3px left border, icon and bold
 * label. Uses `--danger`, never `--down`, so it cannot read as a price drop.
 */
export function ErrorState({ title = 'Something went wrong', message, onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-md border border-l-[3px] border-border border-l-danger bg-surface-1 px-2.5 py-2',
        className,
      )}
    >
      <span aria-hidden="true" className="w-4 flex-none text-center font-mono text-xs font-bold text-danger">
        ×
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 font-semibold text-fg">{title}</p>
        {message ? <p className="m-0 mt-0.5 text-xs text-fg-2">{message}</p> : null}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 h-[var(--control-h)] cursor-pointer rounded-md border border-control-border bg-surface-2 px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-3"
          >
            Try again
          </button>
        ) : null}
      </div>
    </div>
  )
}
