import { buildProspectusEnvelope } from './prospectus-enqueue.service';
import { prospectusBullJobId } from '../jobbus/job-bus.service';
import { JobBus } from '../jobbus/job-bus.service';
import { JobNames } from '../jobbus/job-names';
import { can } from '../auth/tier-policy';

const ID = '5f3c1a2e-9b7d-4e1a-8c3f-2d6b7a9e0f41';

describe('analyze-prospectus envelope + jobId', () => {
  it('builds a system-triggered envelope anchored on the prospectus id', () => {
    const env = buildProspectusEnvelope(ID, new Date('2026-10-07T02:00:00.000Z'));
    expect(env).toMatchObject({
      requestedBy: 'system',
      trigger: 'system',
      asOf: '2026-10-07T02:00:00.000Z',
      payload: { prospectusId: ID },
    });
    expect(env.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('BullMQ dedup id is the hyphen form (no ":"), independent of asOf', () => {
    expect(prospectusBullJobId(ID)).toBe(`prospectus-${ID}`);
    // deriveJobId is private; exercise it through the public contract of the class.
    const derive = (
      JobBus.prototype as unknown as {
        deriveJobId: (n: string, e: unknown) => string;
      }
    ).deriveJobId;
    const a = derive.call({}, JobNames.prospectus, {
      asOf: '2026-10-07T02:00:00Z',
      payload: { prospectusId: ID },
    });
    const b = derive.call({}, JobNames.prospectus, {
      asOf: '2027-01-01T00:00:00Z',
      payload: { prospectusId: ID },
    });
    expect(a).toBe(`prospectus-${ID}`);
    expect(b).toBe(a);
    expect(a).not.toContain(':');
  });

  it('analyze-prospectus is not granted to any tier (system-only, ADR-0005)', () => {
    for (const tier of ['free', 'pro', 'premium'] as const) {
      expect(can({ tier }, 'analyze-prospectus')).toBe(false);
    }
  });
});
