import { afterEach, describe, expect, it, vi } from 'vitest'
import { canRunJob, fetchSession, type SessionUser } from '../lib/auth'
import { apiUrl } from '../lib/api'

/**
 * Unit test for the FE tier show/hide seam (ADR-0005) and the configurable API
 * base (ADR-0005). Also proves the @tuju/contracts type seam compiles/runs:
 * `canRunJob` takes a contract-owned `JobName`, and `fetchSession` parses the
 * contract-owned `SessionUser` schema.
 */
describe('tier show/hide (presentation only, ADR-0005)', () => {
  const free: SessionUser = { userId: '1', tier: 'free' }
  const pro: SessionUser = { userId: '2', tier: 'pro' }

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

describe('fetchSession (GET /auth/me, parsed with contracts SessionUser)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch(res: Response) {
    const fetchMock = vi.fn().mockResolvedValue(res)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('calls /auth/me with credentials and returns the parsed user', async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ userId: 'u1', tier: 'pro' }), { status: 200 }),
    )
    await expect(fetchSession()).resolves.toEqual({ userId: 'u1', tier: 'pro' })
    expect(fetchMock).toHaveBeenCalledWith(
      apiUrl('/auth/me'),
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('returns null when unauthenticated', async () => {
    stubFetch(new Response(null, { status: 401 }))
    await expect(fetchSession()).resolves.toBeNull()
  })

  it('throws on other non-ok responses', async () => {
    stubFetch(new Response(null, { status: 500 }))
    await expect(fetchSession()).rejects.toThrow(/500/)
  })

  it('rejects a response that does not match the SessionUser schema', async () => {
    stubFetch(
      new Response(JSON.stringify({ id: '1', email: 'a@x.my', tier: 'free' }), {
        status: 200,
      }),
    )
    await expect(fetchSession()).rejects.toThrow()
  })
})

describe('configurable API base (ADR-0005)', () => {
  it('joins base and path tolerant of slashes', () => {
    // Default base is empty → same-origin relative path.
    expect(apiUrl('/health')).toBe('/health')
    expect(apiUrl('health')).toBe('/health')
  })
})
