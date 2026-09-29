import { describe, expect, it } from 'vitest'
import { canRunJob, type SessionUser } from '../lib/auth'
import { apiUrl } from '../lib/api'

/**
 * Unit test for the FE tier show/hide seam (ADR-0005) and the configurable API
 * base (ADR-0005). Also proves the @tuju/contracts type seam compiles/runs:
 * `canRunJob` takes a contract-owned `JobName`.
 */
describe('tier show/hide (presentation only, ADR-0005)', () => {
  const free: SessionUser = { id: '1', email: 'a@x.my', tier: 'free' }
  const pro: SessionUser = { id: '2', email: 'b@x.my', tier: 'pro' }

  it('hides paid jobs from the free tier', () => {
    expect(canRunJob(free, 'analyze-technical')).toBe(false)
    expect(canRunJob(free, 'analyze-fundamental')).toBe(false)
  })

  it('shows paid jobs to the pro tier', () => {
    expect(canRunJob(pro, 'analyze-technical')).toBe(true)
    expect(canRunJob(pro, 'analyze-fundamental')).toBe(true)
  })

  it('shows nothing to an anonymous (null) user', () => {
    expect(canRunJob(null, 'analyze-technical')).toBe(false)
  })
})

describe('configurable API base (ADR-0005)', () => {
  it('joins base and path tolerant of slashes', () => {
    // Default base is empty → same-origin relative path.
    expect(apiUrl('/health')).toBe('/health')
    expect(apiUrl('health')).toBe('/health')
  })
})
