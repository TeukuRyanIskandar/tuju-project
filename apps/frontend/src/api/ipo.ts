import { queryOptions } from '@tanstack/react-query'
import { ProspectusAtAGlanceResponse } from '@tuju/contracts'
import { apiGet } from '../lib/api'

// Follow-up: the rich artifact (GET /ipo/:id/at-a-glance/artifact) is omitted
// until the `ProspectusArtifact` schema lands in @tuju/contracts (ADR-0014 §3).

export const ipoKeys = {
  all: ['ipo'] as const,
  atAGlance: (prospectusId: string) => [...ipoKeys.all, prospectusId, 'at-a-glance'] as const,
}

/** GET /ipo/:prospectusId/at-a-glance — the thin summary. */
export const prospectusAtAGlanceQuery = (prospectusId: string) =>
  queryOptions({
    queryKey: ipoKeys.atAGlance(prospectusId),
    queryFn: ({ signal }) =>
      apiGet(
        `/ipo/${encodeURIComponent(prospectusId)}/at-a-glance`,
        ProspectusAtAGlanceResponse,
        { signal },
      ),
  })
