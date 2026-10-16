import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { stockFundamentalResults, stockTechnicalResults } from '#/api/analysis-results'

// Snapshot each imperative lifecycle transition, without polling/subscriptions.
export function useAnalysisLifecycle<S, A>(lifecycle: {
  getState: () => import('#/api/analysis-results').AnalysisResultsState<S, A>
  refreshSummary: () => Promise<S | undefined>
  refreshDetail: () => Promise<unknown>
}) {
  const [snapshot, setSnapshot] = useState(() => ({ lifecycle, state: lifecycle.getState() }))
  const active = useRef({ lifecycle, mounted: false, request: 0 })
  const refresh = useCallback(async () => {
    const owner = active.current
    if (!owner.mounted || owner.lifecycle !== lifecycle) return
    const request = ++owner.request
    const publish = () => {
      if (active.current === owner && owner.mounted && request === owner.request) {
        setSnapshot({ lifecycle, state: lifecycle.getState() })
        return true
      }
      return false
    }
    const pending = lifecycle.refreshSummary()
    publish()
    const summary = await pending
    if (!publish() || summary === undefined) return
    const detail = lifecycle.refreshDetail()
    publish()
    await detail
    publish()
  }, [lifecycle])
  useEffect(() => {
    const owner = { lifecycle, mounted: true, request: 0 }
    active.current = owner
    void refresh()
    return () => { owner.mounted = false; ++owner.request }
  }, [lifecycle, refresh])
  return { state: snapshot.lifecycle === lifecycle ? snapshot.state : lifecycle.getState(), refresh }
}
export function useStockTechnical(code: string) {
  const client = useQueryClient()
  return useAnalysisLifecycle(useMemo(() => stockTechnicalResults(client, code), [client, code]))
}
export function useStockFundamental(code: string) {
  const client = useQueryClient()
  return useAnalysisLifecycle(useMemo(() => stockFundamentalResults(client, code), [client, code]))
}
