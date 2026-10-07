import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router'

/**
 * `/_tokens`: live design-token reference (ticket 10). Dev builds only.
 *
 * The `[_]` in the file name escapes TanStack's leading-underscore rule
 * (`_name` means a pathless layout), so the URL really is `/_tokens`.
 *
 * `import.meta.env.DEV` is replaced by a literal at build time. In a production
 * build the lazy `import()` sits in a dead branch, so the page and everything it
 * pulls in (`src/dev/*`) is never bundled, and `beforeLoad` sends any visit to
 * the not-found page.
 */
export const Route = createFileRoute('/_tokens')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: import.meta.env.DEV ? lazyRouteComponent(() => import('#/dev/tokens-page'), 'TokensPage') : undefined,
})
