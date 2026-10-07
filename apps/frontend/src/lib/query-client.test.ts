import { describe, expect, it } from 'vitest'
import { ContractParseError } from '@tuju/contracts'
import { ApiError } from './api'
import { createQueryClient, shouldRetry } from './query-client'

describe('query client defaults', () => {
  it('uses a 60s staleTime', () => {
    expect(createQueryClient().getDefaultOptions().queries?.staleTime).toBe(60_000)
  })

  it('creates an independent client each call', () => {
    expect(createQueryClient()).not.toBe(createQueryClient())
  })
})

describe('shouldRetry', () => {
  it('never retries 4xx ApiErrors', () => {
    expect(shouldRetry(0, new ApiError(404, null, '/x'))).toBe(false)
    expect(shouldRetry(0, new ApiError(401, null, '/x'))).toBe(false)
  })

  it('never retries contract parse errors', () => {
    expect(shouldRetry(0, new ContractParseError('/x', [], undefined))).toBe(false)
  })

  it('retries 5xx and network errors at most twice', () => {
    for (const err of [new ApiError(503, null, '/x'), new TypeError('network')]) {
      expect(shouldRetry(0, err)).toBe(true)
      expect(shouldRetry(1, err)).toBe(true)
      expect(shouldRetry(2, err)).toBe(false)
    }
  })
})
