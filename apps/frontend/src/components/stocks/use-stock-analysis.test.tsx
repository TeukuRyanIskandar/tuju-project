import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createAnalysisResults } from '#/api/analysis-results'
import { useAnalysisLifecycle } from './use-stock-analysis'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
it('publishes loading, thin summary, rich loading and matched snapshots separately', async () => {
  const thin = deferred<string>()
  const rich = deferred<{ status: 'matched'; artifact: string }>()
  const lifecycle = createAnalysisResults({ identity: '1155-ta', readSummary: () => thin.promise, readArtifact: () => rich.promise })
  const { result } = renderHook(() => useAnalysisLifecycle(lifecycle))
  expect(result.current.state.refreshingSummary).toBe(true)
  await act(async () => thin.resolve('thin'))
  expect(result.current.state.summary).toBe('thin')
  expect(result.current.state.detail.status).toBe('loading')
  await act(async () => rich.resolve({ status: 'matched', artifact: 'rich' }))
  expect(result.current.state.detail).toEqual({ status: 'matched', pair: { summary: 'thin', artifact: 'rich' } })
})
it('retains the old pair with its own summary after a failed refresh', async () => {
  let failing = false
  const lifecycle = createAnalysisResults({ identity: '1155-fa', readSummary: async () => { if (failing) throw Error('private'); return 'old' }, readArtifact: async () => ({ status: 'matched', artifact: 'old artifact' }) })
  const { result } = renderHook(() => useAnalysisLifecycle(lifecycle))
  await waitFor(() => expect(result.current.state.detail.status).toBe('matched'))
  failing = true
  await act(() => result.current.refresh())
  expect(result.current.state.previousPair).toEqual({ summary: 'old', artifact: 'old artifact' })
  expect(result.current.state.summaryError).toBeInstanceOf(Error)
  expect(result.current.state.detail.status).toBe('idle')
})
it('does not publish old-resource completions after navigation or unmount', async () => {
  const old = deferred<string>()
  const first = createAnalysisResults({ identity: '1155', readSummary: () => old.promise, readArtifact: async () => ({ status: 'matched', artifact: 'old artifact' }) })
  const next = createAnalysisResults<string, string>({ identity: '1023', readSummary: async () => 'new', readArtifact: async () => ({ status: 'unavailable' }) })
  const { result, rerender, unmount } = renderHook(({ lifecycle }) => useAnalysisLifecycle(lifecycle), { initialProps: { lifecycle: first } })
  rerender({ lifecycle: next })
  await waitFor(() => expect(result.current.state.summary).toBe('new'))
  await act(async () => old.resolve('old'))
  expect(result.current.state.identity).toBe('1023')
  expect(result.current.state.previousPair).toBeUndefined()
  unmount()
})
it('ignores superseded refresh completions', async () => {
  const reads = [deferred<string>(), deferred<string>()]
  let index = 0
  const lifecycle = createAnalysisResults({ identity: '1155', readSummary: () => reads[index++].promise, readArtifact: async summary => ({ status: 'matched', artifact: summary }) })
  const { result } = renderHook(() => useAnalysisLifecycle(lifecycle))
  let refresh!: Promise<void>
  act(() => { refresh = result.current.refresh() })
  await act(async () => { reads[1].resolve('newest'); await refresh })
  await act(async () => reads[0].resolve('obsolete'))
  expect(result.current.state.summary).toBe('newest')
  expect(result.current.state.detail).toEqual({ status: 'matched', pair: { summary: 'newest', artifact: 'newest' } })
})
it('does not begin a detail read after unmount during a summary read', async () => {
  const thin = deferred<string>()
  const readArtifact = vi.fn(async () => ({ status: 'matched' as const, artifact: 'rich' }))
  const lifecycle = createAnalysisResults({ identity: '1155', readSummary: () => thin.promise, readArtifact })
  const { unmount } = renderHook(() => useAnalysisLifecycle(lifecycle))
  unmount()
  await act(async () => thin.resolve('thin'))
  expect(readArtifact).not.toHaveBeenCalled()
})
