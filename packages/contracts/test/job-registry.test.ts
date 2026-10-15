import { describe, expect, it } from 'vitest';
import { ANALYSIS_QUEUE, JOBS, JobName, Phase, SCHEMA_VERSIONS } from '../src/index.js';

/**
 * The job registry (architecture-deepening ticket 07) is metadata over the
 * contract: every `JobName` has exactly one entry, and each entry only refers
 * to values the contract already defines.
 */
describe('JOBS registry', () => {
  it('has exactly one entry per JobName', () => {
    expect(Object.keys(JOBS).sort()).toEqual([...JobName.options].sort());
  });

  it.each(JobName.options)('%s is consistent with the contract', (name) => {
    const spec = JOBS[name];
    expect(spec.name).toBe(name);
    expect(spec.queue).toBe(ANALYSIS_QUEUE);
    // ADR-0007 §4: fixed, ordered phases bracketed by queued → done.
    expect(spec.phases[0]).toBe('queued');
    expect(spec.phases[spec.phases.length - 1]).toBe('done');
    expect(new Set(spec.phases).size).toBe(spec.phases.length);
    for (const phase of spec.phases) expect(Phase.options).toContain(phase);
    // Colon form: the worker's JobResult.jobId, never the BullMQ custom id.
    expect(spec.resultIdPrefix).toMatch(/^[a-z]+:$/);
    expect(Object.values(SCHEMA_VERSIONS)).toContain(spec.schemaVersion);
  });

  it('result id prefixes are unique (one owner per JobResult.jobId)', () => {
    const prefixes = Object.values(JOBS).map((s) => s.resultIdPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('the union of registered phases is the Phase enum', () => {
    const union = new Set(Object.values(JOBS).flatMap((s) => [...s.phases]));
    expect([...union].sort()).toEqual([...Phase.options].sort());
  });
});
