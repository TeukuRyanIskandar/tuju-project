import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ContractParseError } from '@tuju/contracts'
import { ApiError, VALIDATE_RESPONSES, apiGet, apiUrl, withQuery } from './api'

const Thing = z.strictObject({ id: z.string(), n: z.number() })

function stubFetch(res: Response) {
  const fetchMock = vi.fn().mockResolvedValue(res)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('apiGet', () => {
  it('requests the API URL with credentials and returns the parsed body', async () => {
    const fetchMock = stubFetch(json({ id: 'a', n: 1 }))
    await expect(apiGet('/things/a', Thing)).resolves.toEqual({ id: 'a', n: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      apiUrl('/things/a'),
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('passes init (e.g. an abort signal) through to fetch', async () => {
    const fetchMock = stubFetch(json({ id: 'a', n: 1 }))
    const { signal } = new AbortController()
    await apiGet('/things/a', Thing, { signal })
    expect(fetchMock).toHaveBeenCalledWith(
      apiUrl('/things/a'),
      expect.objectContaining({ credentials: 'include', signal }),
    )
  })

  it('throws ApiError with status, parsed JSON body and path on non-2xx', async () => {
    const body = { statusCode: 404, message: 'No announcement found' }
    stubFetch(json(body, 404))
    const err = await apiGet('/announcements/x', Thing).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 404, body, path: '/announcements/x' })
  })

  it('keeps a non-JSON error body as text', async () => {
    stubFetch(new Response('Bad Gateway', { status: 502 }))
    await expect(apiGet('/things', Thing)).rejects.toMatchObject({
      status: 502,
      body: 'Bad Gateway',
    })
  })

  it('throws ContractParseError when the body does not match the schema', async () => {
    stubFetch(json({ id: 'a', n: 'not-a-number' }))
    const err = await apiGet('/things/a', Thing).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContractParseError)
    expect((err as Error).message).toContain('/things/a')
  })

  it('throws ContractParseError (not a bare SyntaxError) on a non-JSON 2xx body', async () => {
    stubFetch(new Response('<!doctype html><html></html>', { status: 200 }))
    const err = await apiGet('/auth/me', Thing).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContractParseError)
    expect((err as Error).message).toContain('body is not JSON')
  })

  it('rejects an unknown key (strict contract objects)', async () => {
    stubFetch(json({ id: 'a', n: 1, extra: true }))
    await expect(apiGet('/things/a', Thing)).rejects.toBeInstanceOf(ContractParseError)
  })

  it('validates in the test environment', () => {
    expect(VALIDATE_RESPONSES).toBe(true)
  })

  it('returns the body unvalidated in a production build', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('MODE', 'production')
    vi.resetModules()
    const prod = await import('./api')
    expect(prod.VALIDATE_RESPONSES).toBe(false)
    stubFetch(json({ id: 'a', n: 'not-a-number' }))
    await expect(prod.apiGet('/things/a', Thing)).resolves.toEqual({ id: 'a', n: 'not-a-number' })
  })

  it('still throws ApiError on non-2xx in a production build', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('MODE', 'production')
    vi.resetModules()
    const prod = await import('./api')
    stubFetch(json({ message: 'boom' }, 500))
    await expect(prod.apiGet('/things', Thing)).rejects.toMatchObject({ status: 500 })
  })
})

describe('withQuery', () => {
  it('returns the path untouched with no params', () => {
    expect(withQuery('/search')).toBe('/search')
    expect(withQuery('/search', {})).toBe('/search')
  })

  it('drops undefined and null params, keeps falsy values', () => {
    expect(
      withQuery('/screener', { q: undefined, a: null, offset: 0, shariah: false, sort: 'pe' }),
    ).toBe('/screener?offset=0&shariah=false&sort=pe')
  })

  it('returns the bare path when every param is dropped', () => {
    expect(withQuery('/news', { companyCode: undefined })).toBe('/news')
  })

  it('url-encodes values', () => {
    expect(withQuery('/search', { q: 'a&b c' })).toBe('/search?q=a%26b+c')
  })
})
