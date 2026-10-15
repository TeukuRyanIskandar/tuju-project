import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Job } from 'bullmq';
import type { JobEnvelope, JobName, JobResult } from '@tuju/contracts';
import type { JobIdentity } from './job-family';
import {
  JOB_IDENTITIES,
  bullIdFor,
  resolveResultId,
  resultIdFor,
} from './job-identities';
import { JobNames } from './job-names';

const FIXTURES = resolve(__dirname, '../../../../packages/contracts/fixtures');
const fixtureResult = (name: string): JobResult =>
  JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf-8')) as JobResult;

/**
 * BullMQ's own custom-id validation (`Job#validateOptions`, run by
 * `Queue.add`): rejects ids containing `:` (unless exactly three parts) and
 * integer strings. Called directly so the unit lane needs no Redis; the
 * JobBus int-spec adds real ids against Redis.
 */
function assertBullMqLegal(jobId: string): void {
  const validate = (Job.prototype as unknown as {
    validateOptions(this: unknown, jobData: { data: string }): void;
  }).validateOptions;
  validate.call({ name: 'job', opts: { jobId } }, { data: '{}' });
}

function env(asOf: string, payload: object): JobEnvelope<unknown> {
  return {
    correlationId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    requestedBy: 'system',
    trigger: 'system',
    asOf,
    payload,
  } as JobEnvelope<unknown>;
}

const PROSPECTUS_ID = '5f3c1a2e-9b7d-4e1a-8c3f-2d6b7a9e0f41';

/** One row per job name: the envelope, both ids, and the domain key. */
const CASES: Array<{
  jobName: JobName;
  env: JobEnvelope<unknown>;
  bullId: string;
  resultId: string;
  key: unknown;
}> = [
  {
    jobName: JobNames.technical,
    env: env('2026-10-08T18:30:00.000Z', { symbol: '1155', timeframe: '1D' }),
    bullId: 'ta-1155-1D-2026-10-08T18',
    resultId: 'technical:1155:1D:2026-10-08T18',
    key: { stockCode: '1155', discriminator: '1D', hourBucket: '2026-10-08T18' },
  },
  {
    jobName: JobNames.fundamental,
    env: env('2026-10-08T18:30:00.000Z', { symbol: '1155', period: 'quarterly' }),
    bullId: 'fa-1155-quarterly-2026-10-08T18',
    resultId: 'fundamental:1155:quarterly:2026-10-08T18',
    key: { stockCode: '1155', discriminator: 'quarterly', hourBucket: '2026-10-08T18' },
  },
  {
    jobName: JobNames.marketBrief,
    env: env('2026-09-29T20:00:00.000Z', {}),
    bullId: 'brief-2026-09-29',
    resultId: 'brief:2026-09-29',
    key: '2026-09-29',
  },
  {
    jobName: JobNames.announcementSummary,
    env: env('2026-09-29T05:00:00.000Z', { announcementId: '12345' }),
    bullId: 'ann-12345',
    resultId: 'ann:12345',
    key: '12345',
  },
  {
    jobName: JobNames.prospectus,
    env: env('2026-10-07T02:00:00.000Z', { prospectusId: PROSPECTUS_ID }),
    bullId: `prospectus-${PROSPECTUS_ID}`,
    resultId: `prospectus:${PROSPECTUS_ID}`,
    key: PROSPECTUS_ID,
  },
];

describe('job family identities', () => {
  it('covers every JobName', () => {
    expect(CASES.map((c) => c.jobName).sort()).toEqual(
      Object.keys(JOB_IDENTITIES).sort(),
    );
  });

  it('the validator is BullMQ\'s real one (the old TA colon id is rejected)', () => {
    expect(() => assertBullMqLegal('ta:1155:1D:2026-10-08T18')).toThrow(
      'Custom Id cannot contain :',
    );
    expect(() => assertBullMqLegal('12345')).toThrow('Custom Id cannot be integers');
  });

  describe.each(CASES)('$jobName', ({ jobName, env: e, bullId, resultId, key }) => {
    const identity = JOB_IDENTITIES[jobName] as JobIdentity;

    it('derives a BullMQ-legal bull id', () => {
      expect(bullIdFor(jobName, e)).toBe(bullId);
      expect(() => assertBullMqLegal(bullId)).not.toThrow();
    });

    it('derives the worker result id (colon form) and round-trips it', () => {
      expect(identity.key(jobName, e)).toEqual(key);
      expect(resultIdFor(jobName, e)).toBe(resultId);
      expect(identity.parseResultId(resultId)).toEqual({ jobName, key });
      expect(resolveResultId(resultId)).toEqual({ jobName, key });
    });

    it('does not own the bull id or another family\'s result id', () => {
      expect(identity.parseResultId(bullId)).toBeNull();
      for (const other of CASES) {
        if ((JOB_IDENTITIES[other.jobName] as JobIdentity) === identity) continue;
        expect(identity.parseResultId(other.resultId)).toBeNull();
      }
    });
  });

  it('resolves the contract golden result ids the worker emits', () => {
    expect(resolveResultId(fixtureResult('job-result-technical-system.json').jobId)).toEqual({
      jobName: JobNames.technical,
      key: { stockCode: '1155', discriminator: '1D', hourBucket: '2026-10-08T18' },
    });
    expect(
      resolveResultId(fixtureResult('job-result-fundamental-system.json').jobId)?.jobName,
    ).toBe(JobNames.fundamental);
    expect(resolveResultId(fixtureResult('job-result-prospectus.json').jobId)?.jobName).toBe(
      JobNames.prospectus,
    );
  });

  it('owns nothing malformed or legacy', () => {
    for (const id of [
      'prospectus:',
      'brief:',
      'technical:1155:1D', // missing the bucket
      'ta:MAYBANK:1D:2026-09-29T04', // pre-registry legacy scaffold form
      `prospectus-${PROSPECTUS_ID}`,
      '',
    ]) {
      expect(resolveResultId(id)).toBeNull();
    }
  });

  it('buckets asOf in UTC, as the worker does', () => {
    const withOffset = env('2026-10-09T01:30:00+08:00', { symbol: '1155', timeframe: '1D' });
    expect(bullIdFor(JobNames.technical, withOffset)).toBe('ta-1155-1D-2026-10-08T17');
    expect(bullIdFor(JobNames.marketBrief, env('2026-09-30T02:00:00+08:00', {}))).toBe(
      'brief-2026-09-29',
    );
  });
});
