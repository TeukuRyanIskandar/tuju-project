import type { ReactNode } from 'react'
import { EmptyState } from '#/components/states'

/** Stand-in for a page whose content ships in a later feature effort. */
export function PagePlaceholder({ title, detail }: { title: string; detail?: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-5 pb-16">
      <h1 className="m-0 mb-4 text-xl font-semibold text-fg">{title}</h1>
      <EmptyState title="Coming soon" description={detail ?? 'This page is not built yet.'} />
    </div>
  )
}
