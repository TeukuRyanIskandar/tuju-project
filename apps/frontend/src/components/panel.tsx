import { useId, type ReactNode } from 'react'
import { cn } from '#/lib/utils'

export interface PanelProps {
  /** Header label, rendered as an uppercase 11px heading. */
  title: ReactNode
  /** Right-aligned header content: a badge, a count, a timestamp. */
  meta?: ReactNode
  /** Heading level for the title. Default 2. */
  headingLevel?: 2 | 3 | 4
  /** Drop body padding, for a table or chart that spans the full width. */
  flush?: boolean
  className?: string
  bodyClassName?: string
  children: ReactNode
}

/**
 * DESIGN.md panel: 30px `surface-2` header over a `surface-1` body, 1px border,
 * 4px radius, no shadow. The section is named by its title.
 */
export function Panel({
  title,
  meta,
  headingLevel = 2,
  flush = false,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  const titleId = useId()
  const Heading = `h${headingLevel}` as const
  return (
    <section
      aria-labelledby={titleId}
      className={cn('rounded-lg border border-border bg-surface-1', className)}
    >
      <header className="flex h-[30px] items-center gap-2 rounded-t-lg border-b border-border bg-surface-2 px-2.5">
        <Heading id={titleId} className="m-0 text-2xs font-semibold tracking-label text-fg-2 uppercase">
          {title}
        </Heading>
        {meta ? <div className="ml-auto flex items-center gap-2 text-xs text-fg-3">{meta}</div> : null}
      </header>
      <div className={cn(flush ? '' : 'p-2.5', bodyClassName)}>{children}</div>
    </section>
  )
}
