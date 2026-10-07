import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { routeTree } from './routeTree.gen'
import { createQueryClient } from './lib/query-client'

/** Available to every route's `beforeLoad`/`loader` as `context`. */
export interface RouterContext {
  queryClient: QueryClient
}

export function getRouter() {
  // One client per router (per app instance), so cached data is never shared
  // across SSR requests should SSR be enabled later (ADR-0005).
  const queryClient = createQueryClient()

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient } satisfies RouterContext,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    Wrap: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
