import { QueryClient } from '@tanstack/react-query'
import { ContractParseError } from '@tuju/contracts'
import { ApiError } from './api'

/** Reads are cheap to reuse: serve cached data for a minute before refetching. */
export const STALE_TIME_MS = 60_000

const MAX_RETRIES = 2

/**
 * Retry only failures that can plausibly succeed next time. A 4xx is the
 * caller's problem and a contract mismatch is deterministic, so neither is
 * retried; network errors and 5xx get up to {@link MAX_RETRIES} retries.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ContractParseError) return false
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < MAX_RETRIES
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        retry: shouldRetry,
      },
    },
  })
}
