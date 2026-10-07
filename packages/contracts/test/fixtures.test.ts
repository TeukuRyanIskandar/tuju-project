import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AnnouncementSummaryJobEnvelope,
  FundamentalJobEnvelope,
  JobFailure,
  JobProgress,
  JobResult,
  MarketBriefJobEnvelope,
  ProspectusJobEnvelope,
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
