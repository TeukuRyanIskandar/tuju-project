import type { JobEnvelope, JobFailure, JobResult } from '@tuju/contracts';
import type { JobFamily, JobRef } from './job-family';
import {
  marketBriefIdentity,
  prospectusIdentity,
  stockAnalysisIdentity,
} from './job-identities';
import { JobNames } from './job-names';
import { InMemoryJobBus } from './in-memory-job-bus';

/**
 * The JobBus seam's routing and enqueue semantics, through the in-memory
 * adapter (the BullMQ adapter shares the routing; its enqueue is covered
 * against Redis in job-bus.int-spec.ts).
 */

function briefEnv(asOf = '2026-09-29T20:00:00.000Z'): JobEnvelope<object> {
  return {
    correlationId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    requestedBy: 'system',
    trigger: 'system',
    asOf,
    payload: {},
  };
}

function result(jobId: string): JobResult {
  return {
    correlationId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    jobId,
    pointer: {
      bucket: 'tuju-artifacts',
      key: 'k',
      sha256: 'a'.repeat(64),
      bytes: 1,
      contentType: 'application/json',
    },
    summary: { headline: 'h', asOf: '2026-09-29T20:00:00.000Z' },
    at: '2026-09-29T20:01:00.000Z',
  };
}

/** A family that records what it was handed. */
function recordingFamily<I extends JobFamily['identity']>(identity: I) {
  const landed: Array<{ result: JobResult; ref: JobRef }> = [];
  const failed: Array<{ failure: JobFailure; ref: JobRef }> = [];
  const family = {
    identity,
    land: jest.fn(async (r: JobResult, ref: JobRef) => {
      landed.push({ result: r, ref });
    }),
    fail: jest.fn(async (f: JobFailure, ref: JobRef) => {
      failed.push({ failure: f, ref });
    }),
  };
  return { family: family as unknown as JobFamily, landed, failed, raw: family };
}

describe('JobBus routing', () => {
  it('delivers each result to exactly the one family owning its result id', async () => {
    const bus = new InMemoryJobBus();
    const brief = recordingFamily(marketBriefIdentity);
    const stock = recordingFamily(stockAnalysisIdentity);
    bus.register(brief.family);
    bus.register(stock.family);

    await bus.complete(result('brief:2026-09-29'));
    await bus.complete(result('fundamental:1155:quarterly:2026-10-08T18'));

    expect(brief.landed.map((l) => l.ref)).toEqual([
      { jobName: JobNames.marketBrief, key: '2026-09-29' },
    ]);
    expect(stock.landed.map((l) => l.ref)).toEqual([
      {
        jobName: JobNames.fundamental,
        key: { stockCode: '1155', discriminator: 'quarterly', hourBucket: '2026-10-08T18' },
      },
    ]);
  });

  it('drops results no family owns, and ones whose family is not registered here', async () => {
    const bus = new InMemoryJobBus();
    const brief = recordingFamily(marketBriefIdentity);
    bus.register(brief.family);
    const observed: string[] = [];
    bus.onResult((r) => observed.push(r.jobId));

    await bus.complete(result('ta:MAYBANK:1D:2026-09-29T04'));
    await bus.complete(result('prospectus:5f3c1a2e-9b7d-4e1a-8c3f-2d6b7a9e0f41'));

    expect(brief.landed).toHaveLength(0);
    // Observers still see every result (ADR-0007 §8 hook).
    expect(observed).toHaveLength(2);
  });

  it('routes a final failure by the job name, keyed from the envelope', async () => {
    const bus = new InMemoryJobBus();
    const brief = recordingFamily(marketBriefIdentity);
    const stock = recordingFamily(stockAnalysisIdentity);
    bus.register(brief.family);
    bus.register(stock.family);

    const { jobId } = await bus.enqueue(JobNames.marketBrief, briefEnv());
    await bus.failJob(jobId, { userMessage: 'boom' });

    expect(stock.failed).toHaveLength(0);
    expect(brief.failed).toEqual([
      {
        failure: expect.objectContaining({ jobId: 'brief-2026-09-29', userMessage: 'boom' }),
        ref: { jobName: JobNames.marketBrief, key: '2026-09-29' },
      },
    ]);
    // An unknown job (already dropped by the broker) is logged, not routed.
    await bus.failJob('brief-1999-01-01');
    expect(brief.failed).toHaveLength(1);
  });

  it('a family that throws is contained (logged), not propagated', async () => {
    const bus = new InMemoryJobBus();
    const brief = recordingFamily(marketBriefIdentity);
    brief.raw.land.mockRejectedValueOnce(new Error('db down'));
    bus.register(brief.family);
    await expect(bus.complete(result('brief:2026-09-29'))).resolves.toBeUndefined();
  });

  it('a throwing observer never stops the family from landing', async () => {
    const bus = new InMemoryJobBus();
    const brief = recordingFamily(marketBriefIdentity);
    bus.register(brief.family);
    bus.onResult(() => {
      throw new Error('observer bug');
    });
    bus.onFailure(() => {
      throw new Error('observer bug');
    });

    await expect(bus.complete(result('brief:2026-09-29'))).resolves.toBeUndefined();
    expect(brief.landed).toHaveLength(1);

    const { jobId } = await bus.enqueue(JobNames.marketBrief, briefEnv());
    await expect(bus.failJob(jobId)).resolves.toBeUndefined();
    expect(brief.failed).toHaveLength(1);
  });

  it('allows one family per job name, and only with the registered identity', () => {
    const bus = new InMemoryJobBus();
    bus.register(recordingFamily(marketBriefIdentity).family);
    expect(() => bus.register(recordingFamily(marketBriefIdentity).family)).toThrow(
      /already has a job family/,
    );
    const impostor = { ...prospectusIdentity, jobNames: [JobNames.prospectus] };
    expect(() => bus.register(recordingFamily(impostor).family)).toThrow(/JOB_IDENTITIES/);
  });
});

describe('JobBus enqueue: in-flight / replace semantics', () => {
  it('collapses onto an in-flight job; a finished one only with replaceFinished', async () => {
    const bus = new InMemoryJobBus();

    expect(await bus.enqueue(JobNames.marketBrief, briefEnv())).toEqual({
      jobId: 'brief-2026-09-29',
      status: 'enqueued',
    });
    // Same day, later hour: same content-derived id, still waiting.
    expect(
      await bus.enqueue(JobNames.marketBrief, briefEnv('2026-09-29T23:00:00.000Z'), {
        replaceFinished: true,
      }),
    ).toEqual({ jobId: 'brief-2026-09-29', status: 'inFlight' });

    bus.setState('brief-2026-09-29', 'completed');
    expect((await bus.enqueue(JobNames.marketBrief, briefEnv())).status).toBe('finished');
    expect(
      (await bus.enqueue(JobNames.marketBrief, briefEnv(), { replaceFinished: true })).status,
    ).toBe('enqueued');
    expect(bus.job('brief-2026-09-29')?.state).toBe('waiting');
    expect(bus.added).toHaveLength(2);
  });
});
