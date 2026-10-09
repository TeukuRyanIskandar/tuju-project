import { queryOptions } from '@tanstack/react-query'
import { ProspectusArtifact, ProspectusAtAGlanceResponse } from '@tuju/contracts'
import { apiGet } from '../lib/api'

export const ipoKeys = {
  all: ['ipo'] as const,
  atAGlance: (prospectusId: string) => [...ipoKeys.all, prospectusId, 'at-a-glance'] as const,
  // Nested under atAGlance: invalidating a prospectus's at-a-glance also drops its artifact.
  artifact: (prospectusId: string) => [...ipoKeys.atAGlance(prospectusId), 'artifact'] as const,
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

/** GET /ipo/:prospectusId/at-a-glance/artifact — the rich artifact (ADR-0014 §3). */
export const prospectusArtifactQuery = (prospectusId: string) =>
  queryOptions({
    queryKey: ipoKeys.artifact(prospectusId),
    queryFn: ({ signal }) =>
      apiGet(
        `/ipo/${encodeURIComponent(prospectusId)}/at-a-glance/artifact`,
        ProspectusArtifact,
        { signal },
      ),
  })
