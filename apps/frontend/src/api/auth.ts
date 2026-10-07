import { queryOptions } from '@tanstack/react-query'
import { fetchSession } from '../lib/auth'

export const authKeys = {
  all: ['auth'] as const,
  session: () => [...authKeys.all, 'session'] as const,
}

/** Current session user, or `null` when anonymous (GET /auth/me). */
export const sessionQuery = () =>
  queryOptions({
    queryKey: authKeys.session(),
    queryFn: fetchSession,
  })
