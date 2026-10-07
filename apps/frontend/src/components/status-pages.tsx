import { Link, useRouter } from '@tanstack/react-router'
import { EmptyState, ErrorState } from '#/components/states'

const LINK_BUTTON =
  'inline-flex h-[var(--control-h)] items-center rounded-md border border-control-border bg-surface-2 px-3 text-xs font-medium text-fg hover:bg-surface-3'

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-5 pb-16">
      <h1 className="m-0 mb-4 text-xl font-semibold text-fg">Page not found</h1>
      <EmptyState
        title="We couldn't find that page"
        description="The address may be mistyped, or the page may have moved."
        action={
          <Link to="/" className={LINK_BUTTON}>
            Back to market overview
          </Link>
        }
      />
    </div>
  )
}

export function ErrorPage({ error }: { error: unknown }) {
  const router = useRouter()
  return (
    <div className="mx-auto max-w-[1240px] px-4 pt-5 pb-16">
      <h1 className="m-0 mb-4 text-xl font-semibold text-fg">Something went wrong</h1>
      <ErrorState
        title="This page failed to load"
        message={
          import.meta.env.DEV && error instanceof Error ? error.message : 'Try again, or come back in a moment.'
        }
        onRetry={() => void router.invalidate()}
      />
    </div>
  )
}
