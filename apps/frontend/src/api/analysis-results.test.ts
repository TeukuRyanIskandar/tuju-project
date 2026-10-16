import { afterEach, describe, expect, it, vi } from 'vitest'
import { StockTechnicalAnalysisArtifact, type StockTechnicalAnalysisResponse } from '@tuju/contracts'
import { createQueryClient } from '../lib/query-client'
import { createAnalysisResults, stockTechnicalResults, stockFundamentalResults, prospectusResults } from './analysis-results'
import { stockKeys } from './stocks'
import type { ArtifactRead } from './result-coherence'
import technicalJson from '../../../../packages/contracts/fixtures/technical-analysis-artifact.json?raw'

const { cost: _cost, ...body } = JSON.parse(technicalJson)
const artifact = StockTechnicalAnalysisArtifact.parse(body)
const summary: StockTechnicalAnalysisResponse = {
  code: artifact.symbol, jobName: 'analyze-technical', status: 'ready',
  headline: 'Original summary', asOf: new Date(artifact.asOf).toISOString(),
  artifact: { bucket: 'private', key: 'old.json' }, artifactPath: '/old', errorMessage: null,
}
const nextSummary = { ...summary, headline: 'Next summary', asOf: '2026-10-09T18:00:00.000Z',
  artifact: { bucket: 'private', key: 'new.json' } }
const nextArtifact = { ...artifact, asOf: nextSummary.asOf }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
afterEach(() => vi.unstubAllGlobals())

describe('independent analysis summaries and rich detail lifecycle', () => {
  it('thin summary can load alone; explicit refresh reads thin then rich, bypassing fresh cache', async () => {
    const client = createQueryClient()
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(summary))
      .mockResolvedValueOnce(json(nextSummary))
      .mockResolvedValueOnce(json(nextArtifact))
    vi.stubGlobal('fetch', fetch)
    const result = stockTechnicalResults(client, summary.code)
    await result.refreshSummary()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.getState()).toMatchObject({ summary, detail: { status: 'idle' } })
    await result.refresh()
    expect(fetch.mock.calls.map(call => String(call[0]).split('/analysis/')[1])).toEqual([
      'technical', 'technical', 'technical/artifact',
    ])
    expect(result.getState()).toMatchObject({ summary: nextSummary,
      detail: { status: 'matched', pair: { summary: nextSummary, artifact: nextArtifact } } })
    expect(client.getQueryData(stockKeys.artifact(summary.code, 'technical', nextSummary))).toMatchObject({ status: 'matched' })
    client.clear()
  })

  it('preserves thin data on rich failure and only retains previous detail as its own matched pair', async () => {
    const client = createQueryClient()
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(summary)).mockResolvedValueOnce(json(artifact))
      .mockResolvedValueOnce(json(nextSummary)).mockResolvedValueOnce(json({ message: 'missing' }, 404))
      .mockResolvedValueOnce(json({ message: 'thin unavailable' }, 404))
    vi.stubGlobal('fetch', fetch)
    const result = stockTechnicalResults(client, summary.code)
    await result.refresh()
    expect(result.getState().detail.status).toBe('matched')
    await result.refresh()
    expect(result.getState()).toMatchObject({ summary: nextSummary, detail: { status: 'error' },
      previousPair: { summary, artifact } })
    expect(result.getState().detail).not.toHaveProperty('pair')
    await result.refresh()
    expect(result.getState().summary).toEqual(nextSummary)
    expect(result.getState().summaryError).toMatchObject({ status: 404 })
    expect(result.getState().previousPair).toEqual({ summary, artifact })
    await result.refreshDetail()
    expect(fetch).toHaveBeenCalledTimes(5) // failed summary refresh must not read using its old metadata
    client.clear()
  })

  it('makes persistent mismatch and unavailable explicit without hiding the thin summary', async () => {
    const client = createQueryClient()
    const noArtifact = { ...nextSummary, status: 'pending', artifact: null, artifactPath: null, asOf: null }
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(summary)).mockResolvedValueOnce(json(artifact))
      .mockResolvedValueOnce(json(nextSummary)).mockResolvedValueOnce(json(artifact)).mockResolvedValueOnce(json(artifact))
      .mockResolvedValueOnce(json(noArtifact))
    vi.stubGlobal('fetch', fetch)
    const result = stockTechnicalResults(client, summary.code)
    await result.refresh()
    await result.refresh()
    expect(result.getState()).toMatchObject({ summary: nextSummary, detail: { status: 'mismatch' }, previousPair: { summary, artifact } })
    expect(result.getState().detail).not.toHaveProperty('artifact')
    await result.refresh()
    expect(result.getState()).toMatchObject({ summary: noArtifact, detail: { status: 'unavailable' } })
    expect(fetch).toHaveBeenCalledTimes(6)
    client.clear()
  })

  it('never carries retained pairs across resource/kind/prospectus identities', async () => {
    const client = createQueryClient()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(summary)).mockResolvedValueOnce(json(artifact)))
    const original = stockTechnicalResults(client, summary.code)
    await original.refresh()
    const lifecycles = [stockTechnicalResults(client, 'other'), stockFundamentalResults(client, summary.code), prospectusResults(client, 'p1')]
    expect(new Set([original, ...lifecycles].map(value => value.getState().identity)).size).toBe(4)
    for (const lifecycle of lifecycles) {
      expect(lifecycle.getState().summary).toBeUndefined()
      expect(lifecycle.getState().previousPair).toBeUndefined()
      expect(lifecycle.getState().detail).toEqual({ status: 'idle' })
    }
    client.clear()
  })

  it('ignores late artifact/summary completions from superseded refreshes', async () => {
    const rich = deferred<ArtifactRead<string>>()
    const thin = deferred<string>()
    const readSummary = vi.fn().mockResolvedValueOnce('old').mockReturnValueOnce(thin.promise).mockResolvedValueOnce('new')
    const readArtifact = vi.fn().mockReturnValueOnce(rich.promise).mockResolvedValueOnce({ status: 'matched', artifact: 'new detail' })
    const result = createAnalysisResults<string, string>({ identity: 'fixed', readSummary, readArtifact })
    await result.refreshSummary()
    const oldDetail = result.refreshDetail()
    const oldSummary = result.refreshSummary()
    await result.refresh()
    rich.resolve({ status: 'matched', artifact: 'old detail' })
    thin.resolve('obsolete summary')
    await Promise.all([oldDetail, oldSummary])
    expect(result.getState()).toMatchObject({ summary: 'new', detail: { status: 'matched', pair: { summary: 'new', artifact: 'new detail' } } })
    expect(result.getState().previousPair).toBeUndefined()
  })
})
