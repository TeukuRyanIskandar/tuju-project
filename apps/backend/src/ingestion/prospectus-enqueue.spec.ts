import type { DataSource } from 'typeorm';
import {
  buildProspectusEnvelope,
  ProspectusEnqueueService,
} from './prospectus-enqueue.service';
import { InMemoryJobBus } from '../jobbus/in-memory-job-bus';
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

  it('BullMQ dedup id is the hyphen form (no ":"), independent of asOf', async () => {
    const bus = new InMemoryJobBus();
    const a = await bus.enqueue(
      JobNames.prospectus,
      buildProspectusEnvelope(ID, new Date('2026-10-07T02:00:00Z')),
    );
    const b = await bus.enqueue(
      JobNames.prospectus,
      buildProspectusEnvelope(ID, new Date('2027-01-01T00:00:00Z')),
    );
    expect(a).toEqual({ jobId: `prospectus-${ID}`, status: 'enqueued' });
    expect(b).toEqual({ jobId: `prospectus-${ID}`, status: 'inFlight' });
  });

  it('analyze-prospectus is not granted to any tier (system-only, ADR-0005)', () => {
    for (const tier of ['free', 'pro', 'premium'] as const) {
      expect(can({ tier }, 'analyze-prospectus')).toBe(false);
    }
  });
});

describe('ProspectusEnqueueService (in-memory JobBus)', () => {
  const OTHER = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

  function setup(unanalysed: string[]) {
    const dataSource = {
      getRepository: () => ({
        findOne: async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          prospectusS3Key: 'prospectus/x.pdf',
        }),
        createQueryBuilder: () => {
          const qb = {
            select: () => qb,
            where: () => qb,
            andWhere: () => qb,
            orderBy: () => qb,
            addOrderBy: () => qb,
            getRawMany: async () => unanalysed.map((id) => ({ id })),
          };
          return qb;
        },
      }),
    } as unknown as DataSource;
    const bus = new InMemoryJobBus();
    return { bus, service: new ProspectusEnqueueService(dataSource, bus) };
  }

  it('enqueues the unanalysed rows; a re-run while in flight duplicates nothing', async () => {
    const { bus, service } = setup([ID, OTHER]);
    expect(await service.enqueue()).toEqual({ enqueued: [ID, OTHER], alreadyInFlight: [] });
    expect(await service.enqueue()).toEqual({ enqueued: [], alreadyInFlight: [ID, OTHER] });
    expect(bus.added.map((j) => j.id)).toEqual([`prospectus-${ID}`, `prospectus-${OTHER}`]);
    expect(bus.added[0]!.data).toMatchObject({
      requestedBy: 'system',
      trigger: 'system',
      payload: { prospectusId: ID },
    });
  });

  it('a named re-run replaces a retained completed/failed job instead of no-op\'ing', async () => {
    const { bus, service } = setup([]);
    await service.enqueue(ID);
    bus.setState(`prospectus-${ID}`, 'completed');
    expect(await service.enqueue(ID)).toEqual({ enqueued: [ID], alreadyInFlight: [] });
    bus.setState(`prospectus-${ID}`, 'failed');
    expect(await service.enqueue(ID)).toEqual({ enqueued: [ID], alreadyInFlight: [] });
    expect(bus.added).toHaveLength(3);
    expect(bus.job(`prospectus-${ID}`)?.state).toBe('waiting');
  });
});
