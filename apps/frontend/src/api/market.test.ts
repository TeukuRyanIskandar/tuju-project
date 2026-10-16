import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiUrl } from '#/lib/api'
import { indicesQuery, indexSeriesQuery, moversQuery, sectorsQuery } from './market'

afterEach(() => vi.unstubAllGlobals())

describe('market query isolation and transport', () => {
  it('isolates returned IDs and ranges in keys and encodes the ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'id/one', name: 'Index', range: '1m', points: [], provenance: 'synthetic' }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = indexSeriesQuery('id/one', '1m')
    await client.fetchQuery(options)
    expect(fetchMock).toHaveBeenCalledWith(apiUrl('/market/indices/id%2Fone/series?range=1m'), expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }))
    expect(options.queryKey).not.toEqual(indexSeriesQuery('id/two', '1m').queryKey)
    expect(options.queryKey).not.toEqual(indexSeriesQuery('id/one', '3m').queryKey)
    expect(options.queryKey).not.toEqual(indexSeriesQuery('id/one', '1y').queryKey)
    expect(client.getQueryData(indexSeriesQuery('id/two', '1m').queryKey)).toBeUndefined()
    client.clear()
  })

  it.each(['gainers', 'losers', 'actives'] as const)('sends %s and a limit of ten without sharing other board cache', async (type) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ type, limit: 10, rows: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient()
    const options = moversQuery({ type, limit: 10 })
    await client.fetchQuery(options)
    expect(fetchMock).toHaveBeenCalledWith(apiUrl(`/market/movers?type=${type}&limit=10`), expect.objectContaining({ credentials: 'include' }))
    expect(options.queryKey).not.toEqual(moversQuery({ type, limit: 5 }).queryKey)
    expect(options.queryKey).not.toEqual(moversQuery({ type: type === 'gainers' ? 'losers' : 'gainers', limit: 10 }).queryKey)
    client.clear()
  })

  it('keeps indices and sectors in separate caches and uses existing endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ indices: [] })).mockResolvedValueOnce(Response.json({ sectors: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient()
    await client.fetchQuery(indicesQuery())
    await client.fetchQuery(sectorsQuery())
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([apiUrl('/market/indices'), apiUrl('/market/sectors')])
    expect(indicesQuery().queryKey).not.toEqual(sectorsQuery().queryKey)
    client.clear()
  })
})
