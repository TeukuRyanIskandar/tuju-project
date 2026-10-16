import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QueryFunctionContext } from '@tanstack/react-query'
import {
  ContractParseError, ProspectusArtifact, StockTechnicalAnalysisArtifact,
  StockFundamentalAnalysisArtifact, type StockTechnicalAnalysisResponse,
  type StockFundamentalAnalysisResponse, type ProspectusAtAGlanceResponse,
} from '@tuju/contracts'
import { ApiError, apiUrl } from '../lib/api'
import { createQueryClient } from '../lib/query-client'
import {
  stockKeys, stockSeriesQuery, stockTechnicalAnalysisQuery, stockFundamentalAnalysisQuery,
  stockTechnicalArtifactQuery, stockFundamentalArtifactQuery,
} from './stocks'
import { ipoKeys, prospectusArtifactQuery } from './ipo'
import { sameInstant, prospectusArtifactMatches } from './result-coherence'
import technicalJson from '../../../../packages/contracts/fixtures/technical-analysis-artifact.json?raw'
import fundamentalJson from '../../../../packages/contracts/fixtures/fundamental-analysis-artifact.json?raw'
import prospectusJson from '../../../../packages/contracts/fixtures/prospectus-artifact.json?raw'

const withoutCost = (raw: string) => {
  const { cost: _cost, ...body } = JSON.parse(raw)
  return body
}
const technical = StockTechnicalAnalysisArtifact.parse(withoutCost(technicalJson))
const fundamental = StockFundamentalAnalysisArtifact.parse(withoutCost(fundamentalJson))
const prospectus = ProspectusArtifact.parse(JSON.parse(prospectusJson))
const thin = <K extends 'technical' | 'fundamental'>(kind: K, code: string, asOf: string) => ({
  code, jobName: `analyze-${kind}`, status: 'ready', headline: 'Summary', asOf: new Date(asOf).toISOString(),
  artifact: { bucket: 'https://untrusted.example', key: 'private.json' },
  artifactPath: 'https://untrusted.example/artifact', errorMessage: null,
} as const)
const ta: StockTechnicalAnalysisResponse = thin('technical', technical.symbol, technical.asOf)
const fa: StockFundamentalAnalysisResponse = thin('fundamental', fundamental.symbol, fundamental.asOf)
const ipo: ProspectusAtAGlanceResponse = {
  prospectusId: prospectus.prospectusId, headline: prospectus.headline,
  companyName: prospectus.company.name, board: null, listingDate: null, offerPrice: null,
  source: 'real', asOf: new Date(prospectus.provenance.generatedAt).toISOString(),
  artifact: { bucket: 'private', key: 'latest.json' }, artifactPath: 'https://untrusted.example',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function execute(q: { queryFn?: unknown }, signal = new AbortController().signal): Promise<unknown> {
  return (q.queryFn as (ctx: QueryFunctionContext) => Promise<unknown>)({ signal } as QueryFunctionContext)
}
function mockBodies(...bodies: unknown[]) {
  const mock = vi.fn()
  for (const body of bodies) mock.mockResolvedValueOnce(json(body))
  vi.stubGlobal('fetch', mock)
  return mock
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('analysis keys and fixed API transport', () => {
  it('isolates stock, kind, series and expected date/pointer/path identities', () => {
    const keys = [
      stockKeys.series('1155'), stockKeys.series('1023'),
      stockKeys.analysis('1155', 'technical'), stockKeys.analysis('1155', 'fundamental'),
      stockKeys.artifact(ta.code, 'technical', ta),
      stockKeys.artifact(ta.code, 'technical', { ...ta, asOf: '2026-11-01T00:00:00Z' }),
      stockKeys.artifact(ta.code, 'technical', { ...ta, artifact: { ...ta.artifact!, key: 'new' } }),
      stockKeys.artifact(ta.code, 'technical', { ...ta, artifact: { ...ta.artifact!, bucket: 'new' } }),
      stockKeys.artifact(ta.code, 'technical', { ...ta, artifactPath: '/new' }),
      ipoKeys.artifact(ipo.prospectusId, ipo),
      ipoKeys.artifact(ipo.prospectusId, { ...ipo, asOf: '2026-11-01T00:00:00Z' }),
      ipoKeys.artifact(ipo.prospectusId, { ...ipo, artifact: { ...ipo.artifact, key: 'new' } }),
      ipoKeys.artifact(ipo.prospectusId, { ...ipo, artifactPath: '/new' }),
    ].map(key => JSON.stringify(key))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('reads fixed series window and both thin envelope routes with encoded codes', async () => {
    const code = 'A/B 1'
    const series = { code, interval: '1d', range: '2y', points: [], provenance: 'real', demoLabel: 'private-demo' }
    const fetch = mockBodies(series, { ...ta, code }, { ...fa, code })
    await expect(execute(stockSeriesQuery(code))).resolves.toEqual(series)
    await execute(stockTechnicalAnalysisQuery(code))
    await execute(stockFundamentalAnalysisQuery(code))
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      apiUrl('/stocks/A%2FB%201/series?interval=1d&range=2y'),
      apiUrl('/stocks/A%2FB%201/analysis/technical'),
      apiUrl('/stocks/A%2FB%201/analysis/fundamental'),
    ])
  })

  it('uses configurable API base, credentials and signal, never pointer/path URLs', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example/v1/')
    vi.resetModules()
    const builders = await import('./stocks')
    const code = 'A/B 1'
    const signal = new AbortController().signal
    const fetch = mockBodies({ ...technical, symbol: code })
    await expect(execute(builders.stockTechnicalArtifactQuery(code, { ...ta, code }), signal))
      .resolves.toMatchObject({ status: 'matched' })
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://api.example/v1/stocks/A%2FB%201/analysis/technical/artifact', {
      credentials: 'include', signal,
    })
  })

  it('gates rich reads on expected complete metadata even with imperative fetchQuery', async () => {
    const fetch = mockBodies()
    for (const expected of [null, { ...ta, asOf: null }, { ...ta, artifact: null }, { ...ta, artifactPath: null }, { ...ta, code: 'other' }]) {
      const query = stockTechnicalArtifactQuery(ta.code, expected)
      expect(query.enabled).toBe(false)
      await expect(execute(query)).resolves.toEqual({ status: 'unavailable' })
    }
    const query = prospectusArtifactQuery('other', ipo)
    expect(query.enabled).toBe(false)
    await expect(execute(query)).resolves.toEqual({ status: 'unavailable' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('mutable-latest artifact coherence', () => {
  it('normalizes timestamp offsets/zeros without erasing microsecond differences', () => {
    expect(sameInstant('2026-10-08T18:00:00.123456+08:00', '2026-10-08T10:00:00.1234560Z')).toBe(true)
    expect(sameInstant('2026-10-08T10:00:00.123456Z', '2026-10-08T10:00:00.123457Z')).toBe(false)
    expect(sameInstant('invalid', 'invalid')).toBe(false)
  })

  it('exposes TA/FA artifacts only after matching stock, kind and exact timestamp', async () => {
    for (const [artifact, query] of [
      [technical, stockTechnicalArtifactQuery(ta.code, ta)],
      [fundamental, stockFundamentalArtifactQuery(fa.code, fa)],
    ] as const) {
      for (const wrong of [{ ...artifact, symbol: 'other' }, { ...artifact, asOf: '2000-01-01T00:00:00Z' }]) {
        const fetch = mockBodies(wrong, artifact)
        await expect(execute(query)).resolves.toEqual({ status: 'matched', artifact })
        expect(fetch).toHaveBeenCalledTimes(2)
      }
      mockBodies(artifact)
      await expect(execute(query)).resolves.toEqual({ status: 'matched', artifact })
      expect(fetch).toHaveBeenCalledTimes(1)
    }
    mockBodies(fundamental)
    await expect(execute(stockTechnicalArtifactQuery(ta.code, ta))).rejects.toBeInstanceOf(ContractParseError)
  })

  it('returns typed persistent mismatch after exactly two HTTP reads, without generic retries', async () => {
    const client = createQueryClient()
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } })
    const wrong = { ...technical, symbol: 'other' }
    const fetch = mockBodies(wrong, wrong)
    await expect(client.fetchQuery(stockTechnicalArtifactQuery(ta.code, ta))).resolves.toEqual({ status: 'mismatch' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(client.getQueryData(stockTechnicalArtifactQuery(ta.code, ta).queryKey)).toEqual({ status: 'mismatch' })
    client.clear()
  })

  it('checks IPO ID, headline and generation lower bound (asOf is not generation time)', async () => {
    expect(prospectusArtifactMatches(ipo.prospectusId, { ...ipo, asOf: '2000-01-01T00:00:00Z' }, prospectus)).toBe(true)
    expect(prospectusArtifactMatches(ipo.prospectusId, { ...ipo, asOf: '2099-01-01T00:00:00Z' }, prospectus)).toBe(false)
    for (const wrong of [
      { ...prospectus, prospectusId: 'other' }, { ...prospectus, headline: 'different run' },
      { ...prospectus, provenance: { ...prospectus.provenance, generatedAt: '1999-01-01T00:00:00Z' } },
    ]) {
      const fetch = mockBodies(wrong, wrong)
      await expect(execute(prospectusArtifactQuery(ipo.prospectusId, ipo))).resolves.toEqual({ status: 'mismatch' })
      expect(fetch).toHaveBeenCalledTimes(2)
    }
    const fetch = mockBodies({ ...prospectus, headline: 'old' }, prospectus)
    await expect(execute(prospectusArtifactQuery(ipo.prospectusId, ipo))).resolves.toEqual({ status: 'matched', artifact: prospectus })
    expect(fetch.mock.calls[0]![0]).toBe(apiUrl(`/ipo/${encodeURIComponent(ipo.prospectusId)}/at-a-glance/artifact`))
  })

  it('does not do a mismatch retry on HTTP/schema failures; preserves generic retry policy', async () => {
    const client = createQueryClient()
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } })
    for (const [response, error, calls] of [
      [() => json({ message: 'missing' }, 404), ApiError, 1],
      [() => json({}), ContractParseError, 1],
      [() => json({ message: 'down' }, 503), ApiError, 3],
    ] as const) {
      const fetch = vi.fn().mockImplementation(async () => response())
      vi.stubGlobal('fetch', fetch)
      await expect(client.fetchQuery(stockTechnicalArtifactQuery(ta.code, ta))).rejects.toBeInstanceOf(error)
      expect(fetch).toHaveBeenCalledTimes(calls)
      client.clear()
    }
  })

  it('cancellation after first mismatched HTTP read prevents the second read', async () => {
    const controller = new AbortController()
    const fetch = vi.fn().mockImplementation(async () => {
      controller.abort()
      return json({ ...technical, symbol: 'other' })
    })
    vi.stubGlobal('fetch', fetch)
    await expect(execute(stockTechnicalArtifactQuery(ta.code, ta), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(execute(stockTechnicalArtifactQuery(ta.code, ta), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('QueryClient cancellation aborts an in-flight artifact without starting another read', async () => {
    const client = createQueryClient()
    let received: AbortSignal | undefined
    const fetch = vi.fn().mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      received = init.signal as AbortSignal
      received.addEventListener('abort', () => reject(received!.reason))
    }))
    vi.stubGlobal('fetch', fetch)
    const query = stockTechnicalArtifactQuery(ta.code, ta)
    const result = client.fetchQuery(query).catch(error => error)
    await client.cancelQueries({ queryKey: query.queryKey })
    await result
    expect(received?.aborted).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(query.queryKey)).toBeUndefined()
    client.clear()
  })
})
