import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QueryFunctionContext } from '@tanstack/react-query'
import { ContractParseError, type ProspectusAtAGlanceResponse } from '@tuju/contracts'
import { apiUrl } from '../lib/api'
import { announcementQuery, announcementsQuery } from './announcements'
import { sessionQuery } from './auth'
import { prospectusArtifactQuery, prospectusAtAGlanceQuery } from './ipo'
import { indexSeriesQuery, moversQuery } from './market'
import { screenerQuery } from './screener'
import { searchQuery } from './search'
import { stockAnnouncementsQuery, stockCoreQuery } from './stocks'
import { prospectus as artifactFixture } from '../test/analysis-fixtures'

/** Run a builder's queryFn against a stubbed fetch and return the requested URL. */
async function run(
  options: { queryFn?: unknown },
  body: unknown,
  status = 200,
): Promise<{ url: string; result: unknown }> {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  const fn = options.queryFn as (ctx: QueryFunctionContext) => Promise<unknown>
  const result = await fn({ signal: new AbortController().signal } as QueryFunctionContext)
  return { url: fetchMock.mock.calls[0]![0] as string, result }
}

afterEach(() => vi.unstubAllGlobals())

describe('src/api query builders', () => {
  it('searchQuery: key carries params; omits an unset limit', async () => {
    const q = searchQuery({ q: 'maybank' })
    expect(q.queryKey).toEqual(['search', { q: 'maybank' }])
    const { url } = await run(q, { query: 'maybank', items: [] })
    expect(url).toBe(apiUrl('/search?q=maybank'))
  })

  it('stockCoreQuery: encodes the path param', async () => {
    const q = stockCoreQuery('A/B 1')
    expect(q.queryKey).toEqual(['stocks', 'A/B 1', 'core'])
    await expect(run(q, {})).rejects.toThrow() // empty body fails the contract
    expect(fetch).toHaveBeenCalledWith(
      apiUrl('/stocks/A%2FB%201'),
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('stockAnnouncementsQuery: comma-joins category, passes paging', async () => {
    const q = stockAnnouncementsQuery('1155', {
      category: ['GENERAL', 'MEETING'],
      offset: 20,
      limit: 10,
    })
    const { url, result } = await run(q, { items: [], total: 0, offset: 20, limit: 10 })
    expect(url).toBe(
      apiUrl('/stocks/1155/announcements?category=GENERAL%2CMEETING&offset=20&limit=10'),
    )
    expect(result).toEqual({ items: [], total: 0, offset: 20, limit: 10 })
  })

  it('screenerQuery: serialises lists, booleans and numbers; drops unset', async () => {
    const q = screenerQuery({
      board: ['MAIN', 'ACE'],
      shariah: true,
      peMax: 15,
      sort: 'pe',
      dir: 'asc',
    })
    const { url } = await run(q, {
      items: [],
      total: 0,
      offset: 0,
      limit: 50,
      sort: 'pe',
      dir: 'asc',
    })
    const parsed = new URL(url, 'http://x')
    expect(parsed.pathname).toBe('/screener')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      board: 'MAIN,ACE',
      shariah: 'true',
      peMax: '15',
      sort: 'pe',
      dir: 'asc',
    })
  })

  it('announcementQuery / announcementsQuery hit the right paths', async () => {
    const detail = announcementQuery('abc')
    expect(detail.queryKey).toEqual(['announcements', 'detail', 'abc'])
    await expect(run(detail, {})).rejects.toThrow()
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(apiUrl('/announcements/abc'))

    const list = announcementsQuery({ companyCode: '1155', from: '2026-01-01' })
    const { url } = await run(list, { items: [], total: 0, offset: 0, limit: 50 })
    expect(url).toBe(apiUrl('/announcements?companyCode=1155&from=2026-01-01'))
  })

  it('market builders', async () => {
    const movers = moversQuery({ type: 'losers', limit: 5 })
    expect(movers.queryKey).toEqual(['market', 'movers', { type: 'losers', limit: 5 }])
    const m = await run(movers, { type: 'losers', limit: 5, rows: [] })
    expect(m.url).toBe(apiUrl('/market/movers?type=losers&limit=5'))

    const series = indexSeriesQuery('idx-1', '3m')
    const s = await run(series, {
      id: 'idx-1',
      name: 'KLCI',
      range: '3m',
      points: [],
      provenance: 'real',
    })
    expect(s.url).toBe(apiUrl('/market/indices/idx-1/series?range=3m'))
  })

  it('prospectusAtAGlanceQuery hits /ipo/:id/at-a-glance', async () => {
    const q = prospectusAtAGlanceQuery('p 1')
    expect(q.queryKey).toEqual(['ipo', 'p 1', 'at-a-glance'])
    await expect(run(q, {})).rejects.toThrow()
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(apiUrl('/ipo/p%201/at-a-glance'))
  })

  it('prospectusArtifactQuery hits /ipo/:id/at-a-glance/artifact and parses the contract', async () => {
    const fixture = artifactFixture
    const summary: ProspectusAtAGlanceResponse = {
      prospectusId: fixture.prospectusId, headline: fixture.headline,
      companyName: fixture.company.name, board: null, listingDate: null, offerPrice: null,
      asOf: fixture.provenance.generatedAt, source: 'real',
      artifact: { bucket: 'private', key: 'artifact.json' }, artifactPath: '/ignored',
    }
    const q = prospectusArtifactQuery(fixture.prospectusId, summary)
    expect(q.queryKey.slice(0, 4)).toEqual(['ipo', fixture.prospectusId, 'at-a-glance', 'artifact'])
    await expect(run(q, {})).rejects.toBeInstanceOf(ContractParseError)
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(apiUrl(`/ipo/${encodeURIComponent(fixture.prospectusId)}/at-a-glance/artifact`))
    const { result } = await run(q, fixture)
    expect(result).toEqual({ status: 'matched', artifact: fixture })
  })

  it('sessionQuery resolves null when anonymous', async () => {
    const q = sessionQuery()
    expect(q.queryKey).toEqual(['auth', 'session'])
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect((q.queryFn as () => Promise<unknown>)()).resolves.toBeNull()
    expect(fetchMock.mock.calls[0]![0]).toBe(apiUrl('/auth/me'))
  })
})
