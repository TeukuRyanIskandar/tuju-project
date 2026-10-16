import { queryOptions } from '@tanstack/react-query'
import { ProspectusArtifact, ProspectusAtAGlanceResponse } from '@tuju/contracts'
import { apiGet } from '../lib/api'
import {
  canReadProspectusArtifact, prospectusArtifactMatches, readCoherentArtifact,
  resultIdentity, type ArtifactRead,
} from './result-coherence'

export const ipoKeys = {
  all: ['ipo'] as const,
  atAGlance: (prospectusId: string) => [...ipoKeys.all, prospectusId, 'at-a-glance'] as const,
  // Nested under atAGlance: invalidation marks summary and rich reads stale together.
  artifact: (prospectusId: string, expected: ProspectusAtAGlanceResponse | null) =>
    [...ipoKeys.atAGlance(prospectusId), 'artifact', resultIdentity(expected), expected?.headline, expected?.prospectusId] as const,
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
export const prospectusArtifactQuery = (prospectusId: string, expected: ProspectusAtAGlanceResponse | null) =>
  queryOptions({
    queryKey: ipoKeys.artifact(prospectusId, expected),
    enabled: canReadProspectusArtifact(prospectusId, expected),
    queryFn: ({ signal }): Promise<ArtifactRead<ProspectusArtifact>> => {
      if (!canReadProspectusArtifact(prospectusId, expected)) return Promise.resolve({ status: 'unavailable' })
      return readCoherentArtifact(
        () => apiGet(`/ipo/${encodeURIComponent(prospectusId)}/at-a-glance/artifact`, ProspectusArtifact, { signal }),
        artifact => prospectusArtifactMatches(prospectusId, expected, artifact), signal,
      )
    },
  })
