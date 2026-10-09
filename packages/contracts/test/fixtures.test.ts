import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AnnouncementSummaryJobEnvelope,
  FundamentalAnalysisArtifact,
  FundamentalJobEnvelope,
  JobFailure,
  JobProgress,
  JobResult,
  MarketBriefJobEnvelope,
  ProspectusArtifact,
  ProspectusJobEnvelope,
  TechnicalAnalysisArtifact,
  TechnicalJobEnvelope,
} from '../src/index.js';

/**
 * Runtime conformance (ADR-0011): every golden fixture must parse against its
 * Zod schema. The SAME fixture files are validated by the Python test suite
 * against the generated Pydantic models — that cross-language agreement is the
 * point of the shared fixtures.
 */
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const load = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));

describe('golden fixtures conform to the Zod contract', () => {
  it('technical-job-envelope.json', () => {
    expect(() => TechnicalJobEnvelope.parse(load('technical-job-envelope.json'))).not.toThrow();
  });

  it('fundamental-job-envelope.json', () => {
    expect(() =>
      FundamentalJobEnvelope.parse(load('fundamental-job-envelope.json')),
    ).not.toThrow();
  });

  it('job-progress.json', () => {
    expect(() => JobProgress.parse(load('job-progress.json'))).not.toThrow();
  });

  it('job-result.json', () => {
    expect(() => JobResult.parse(load('job-result.json'))).not.toThrow();
  });

  it('job-result-system.json (verdict-less summary)', () => {
    expect(() => JobResult.parse(load('job-result-system.json'))).not.toThrow();
  });

  it('job-failure.json', () => {
    expect(() => JobFailure.parse(load('job-failure.json'))).not.toThrow();
  });

  it('market-brief-job-envelope.json', () => {
    expect(() =>
      MarketBriefJobEnvelope.parse(load('market-brief-job-envelope.json')),
    ).not.toThrow();
  });

  it('announcement-summary-job-envelope.json', () => {
    expect(() =>
      AnnouncementSummaryJobEnvelope.parse(
        load('announcement-summary-job-envelope.json'),
      ),
    ).not.toThrow();
  });

  it('prospectus-job-envelope.json', () => {
    expect(() =>
      ProspectusJobEnvelope.parse(load('prospectus-job-envelope.json')),
    ).not.toThrow();
  });

  it('job-result-prospectus.json (verdict-less summary)', () => {
    expect(() => JobResult.parse(load('job-result-prospectus.json'))).not.toThrow();
  });

  it('job-result-technical-system.json (PoC TA SystemSummary)', () => {
    expect(() =>
      JobResult.parse(load('job-result-technical-system.json')),
    ).not.toThrow();
  });

  it('job-result-fundamental-system.json (PoC FA SystemSummary)', () => {
    expect(() =>
      JobResult.parse(load('job-result-fundamental-system.json')),
    ).not.toThrow();
  });
});

describe('the contract rejects malformed payloads', () => {
  it('rejects an unknown trigger', () => {
    const bad = { ...(load('technical-job-envelope.json') as object), trigger: 'nope' };
    expect(() => TechnicalJobEnvelope.parse(bad)).toThrow();
  });

  it('rejects an out-of-enum verdict', () => {
    const good = load('job-result.json') as { summary: Record<string, unknown> };
    const bad = { ...good, summary: { ...good.summary, verdict: 'mega-bullish' } };
    expect(() => JobResult.parse(bad)).toThrow();
  });
});

describe('the system trigger and verdict-less summary', () => {
  it('accepts the system trigger on a job envelope', () => {
    const good = load('technical-job-envelope.json') as object;
    const withSystemTrigger = { ...good, trigger: 'system' };
    expect(() => TechnicalJobEnvelope.parse(withSystemTrigger)).not.toThrow();
  });

  it('rejects a SystemSummary missing its required headline', () => {
    const good = load('job-result-system.json') as { summary: Record<string, unknown> };
    const bad = { ...good, summary: { ...good.summary, headline: undefined } };
    expect(() => JobResult.parse(bad)).toThrow();
  });
});

describe('the prospectus job', () => {
  it('rejects a prospectus payload missing prospectusId', () => {
    const good = load('prospectus-job-envelope.json') as object;
    expect(() => ProspectusJobEnvelope.parse({ ...good, payload: {} })).toThrow();
  });

  it('accepts the system trigger on the prospectus envelope', () => {
    const good = load('prospectus-job-envelope.json') as { trigger: string };
    expect(good.trigger).toBe('system');
  });

  it('rejects an unknown key on the prospectus result summary', () => {
    const good = load('job-result-prospectus.json') as { summary: Record<string, unknown> };
    const bad = { ...good, summary: { ...good.summary, source: 'real' } };
    expect(() => JobResult.parse(bad)).toThrow();
  });
});

describe('the prospectus artifact', () => {
  type Artifact = {
    headline?: string;
    provenance: Record<string, unknown>;
    sections: { whatToWatch: Record<string, unknown> };
    [k: string]: unknown;
  };
  const good = (): Artifact => load('prospectus-artifact.json') as Artifact;

  it('prospectus-artifact.json', () => {
    expect(() => ProspectusArtifact.parse(load('prospectus-artifact.json'))).not.toThrow();
  });

  it('accepts a Z-suffixed generatedAt too', () => {
    const a = good();
    a.provenance.generatedAt = '2026-10-07T02:04:30Z';
    expect(() => ProspectusArtifact.parse(a)).not.toThrow();
  });

  it('rejects a missing headline', () => {
    const a = good();
    delete a.headline;
    expect(() => ProspectusArtifact.parse(a)).toThrow();
  });

  it('rejects an unknown top-level key', () => {
    expect(() => ProspectusArtifact.parse({ ...good(), extra: 1 })).toThrow();
  });

  it('rejects a whatToWatch section that carries routing', () => {
    const a = good();
    a.sections.whatToWatch.routing = {};
    expect(() => ProspectusArtifact.parse(a)).toThrow();
  });

  it('rejects an out-of-enum risk severity', () => {
    const a = good() as unknown as {
      sections: { riskFactors: { data: { themes: Record<string, unknown>[] } } };
    };
    a.sections.riskFactors.data.themes[0].severity = 'critical';
    expect(() => ProspectusArtifact.parse(a)).toThrow();
  });
});

describe('the technical analysis artifact', () => {
  it('technical-analysis-artifact.json', () => {
    expect(() =>
      TechnicalAnalysisArtifact.parse(load('technical-analysis-artifact.json')),
    ).not.toThrow();
  });

  it('rejects a root headline', () => {
    const a = load('technical-analysis-artifact.json') as Record<string, unknown>;
    expect(() =>
      TechnicalAnalysisArtifact.parse({ ...a, headline: 'should not exist' }),
    ).toThrow();
  });

  it('rejects an out-of-enum event id', () => {
    const a = load('technical-analysis-artifact.json') as {
      events: Record<string, unknown>[];
    };
    a.events[0].id = 'buy_signal';
    expect(() => TechnicalAnalysisArtifact.parse(a)).toThrow();
  });
});

describe('the fundamental analysis artifact', () => {
  it('fundamental-analysis-artifact.json', () => {
    expect(() =>
      FundamentalAnalysisArtifact.parse(load('fundamental-analysis-artifact.json')),
    ).not.toThrow();
  });

  it('accepts a null metric value', () => {
    const a = load('fundamental-analysis-artifact.json') as {
      metrics: { id: string; value: number | null }[];
    };
    const debt = a.metrics.find((m) => m.id === 'debt_to_equity');
    expect(debt?.value).toBeNull();
    expect(() => FundamentalAnalysisArtifact.parse(a)).not.toThrow();
  });

  it('rejects a metrics array that omits a slot', () => {
    const a = load('fundamental-analysis-artifact.json') as {
      metrics: unknown[];
    };
    a.metrics = a.metrics.slice(0, 8);
    expect(() => FundamentalAnalysisArtifact.parse(a)).toThrow();
  });
});
