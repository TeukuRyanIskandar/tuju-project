import type { ComponentProps } from 'react'
import { cn } from '#/lib/utils'

/** Keyboard shortcut hint: mono 11px with a 2px bottom border. */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-block rounded-sm border border-b-2 border-border-strong bg-surface-2 px-[5px] py-px font-mono text-2xs font-medium text-fg-2',
        className,
      )}
      {...props}
    />
  )
}
