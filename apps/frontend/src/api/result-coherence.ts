import type {
  ProspectusArtifact,
  ProspectusAtAGlanceResponse,
  StockTechnicalAnalysisResponse,
  StockFundamentalAnalysisResponse,
  StockTechnicalAnalysisArtifact,
  StockFundamentalAnalysisArtifact,
} from '@tuju/contracts'

export type ArtifactRead<A> =
  | { status: 'matched'; artifact: A }
  | { status: 'mismatch' }
  | { status: 'unavailable' }

export type StockAnalysisKind = 'technical' | 'fundamental'
export type StockAnalysisSummary = StockTechnicalAnalysisResponse | StockFundamentalAnalysisResponse
type StockArtifact = StockTechnicalAnalysisArtifact | StockFundamentalAnalysisArtifact

/** Preserve fractional precision (Python can emit microseconds), normalize offsets. */
function instant(value: string): { seconds: number; fraction: string } | undefined {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return undefined
  const seconds = Date.parse(`${match[1]}${match[3]}`)
  if (!Number.isFinite(seconds)) return undefined
  return { seconds, fraction: (match[2] ?? '').replace(/0+$/, '') }
}

export function sameInstant(a: string, b: string): boolean {
  const left = instant(a)
  const right = instant(b)
  return !!left && !!right && left.seconds === right.seconds && left.fraction === right.fraction
}

function atOrAfter(a: string, b: string): boolean {
  const left = instant(a)
  const right = instant(b)
  if (!left || !right) return false
  return left.seconds > right.seconds ||
    (left.seconds === right.seconds && left.fraction >= right.fraction)
}

/** Pointer/path are cache identity only, never a transport destination. */
export function resultIdentity(summary: {
  asOf: string | null
  artifact: { bucket: string; key: string } | null
  artifactPath: string | null
} | null) {
  return summary ? [summary.asOf, summary.artifact?.bucket, summary.artifact?.key, summary.artifactPath] as const : null
}

export function canReadStockArtifact(code: string, kind: StockAnalysisKind, summary: StockAnalysisSummary | null): summary is StockAnalysisSummary {
  return !!summary && summary.code === code && summary.jobName === `analyze-${kind}` &&
    !!summary.asOf && !!summary.artifact?.bucket && !!summary.artifact.key && !!summary.artifactPath
}

export function stockArtifactMatches(code: string, kind: StockAnalysisKind, summary: StockAnalysisSummary, artifact: StockArtifact): boolean {
  return canReadStockArtifact(code, kind, summary) && artifact.symbol === code &&
    artifact.jobName === summary.jobName && sameInstant(artifact.asOf, summary.asOf!)
}

export function canReadProspectusArtifact(id: string, summary: ProspectusAtAGlanceResponse | null): summary is ProspectusAtAGlanceResponse {
  return !!summary && summary.prospectusId === id && !!summary.asOf &&
    !!summary.artifact?.bucket && !!summary.artifact.key && !!summary.artifactPath
}

export function prospectusArtifactMatches(id: string, summary: ProspectusAtAGlanceResponse, artifact: ProspectusArtifact): boolean {
  // IPO asOf is the enqueue timestamp, NOT generatedAt. The visible generation
  // checks are a lower bound plus headline equality, not proof of provenance.
  return canReadProspectusArtifact(id, summary) && artifact.prospectusId === id &&
    artifact.headline === summary.headline &&
    atOrAfter(artifact.provenance.generatedAt, summary.asOf)
}

/** A mismatch is data, not an exception: Query's generic retries must not multiply it. */
export async function readCoherentArtifact<A>(
  read: () => Promise<A>,
  matches: (artifact: A) => boolean,
  signal: AbortSignal,
): Promise<ArtifactRead<A>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted()
    const artifact = await read()
    signal.throwIfAborted()
    if (matches(artifact)) return { status: 'matched', artifact }
  }
  return { status: 'mismatch' }
}
