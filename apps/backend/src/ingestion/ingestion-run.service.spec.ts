import type { EntityManager } from 'typeorm';
import type { SourceAdapter } from '../data/adapters/adapter.interfaces';
import { ProvenanceClass } from '../data/entities/enums';
import { IngestionRun } from '../data/entities/ingestion-run.entity';
import { SyntheticRun } from '../data/entities/synthetic-run.entity';
import { IngestionRunService } from './ingestion-run.service';

/**
 * The Ingestion run module (architecture-deepening ticket 05): the run is
 * opened from the adapter's own declaration and the fetch failures come back
 * as data. The real INSERT/STI mapping is covered in the int lane
 * (`ingestion.int-spec.ts`, `klci-ops.int-spec.ts`); here the manager is an
 * in-memory stand-in that records what each run row would hold.
 */
function fakeManager() {
  const standard: { adapter: string; provenanceClass: ProvenanceClass }[] = [];
  const synthetic: Partial<SyntheticRun>[] = [];
  const manager = {
    query: async (_sql: string, params: unknown[]) => {
      standard.push({
        adapter: params[1] as string,
        provenanceClass: params[2] as ProvenanceClass,
      });
      return [{ id: `run-${standard.length}` }];
    },
    getRepository: (entity: unknown) => {
      if (entity === IngestionRun) {
        return { findOneByOrFail: async ({ id }: { id: string }) => ({ id }) };
      }
      if (entity === SyntheticRun) {
        return {
          create: (row: Partial<SyntheticRun>) => row,
          save: async (row: Partial<SyntheticRun>) => {
            synthetic.push(row);
            return { ...row, id: `synthetic-${synthetic.length}` };
          },
        };
      }
      throw new Error('unexpected repository');
    },
  } as unknown as EntityManager;
  return { manager, standard, synthetic };
}

const licensedFeed: SourceAdapter = {
  adapterName: 'LicensedBursaFeedAdapter',
  provenanceClass: ProvenanceClass.Real,
};

describe('IngestionRunService.run', () => {
  const runs = new IngestionRunService();

  it("opens the run from the adapter's own name + provenance and passes its id to the landing step", async () => {
    const { manager, standard } = fakeManager();
    const landedInto: string[] = [];

    const outcome = await runs.run(manager, licensedFeed, async (runId) => {
      landedInto.push(runId);
      return { value: 3, failures: [] };
    });

    expect(standard).toEqual([
      { adapter: 'LicensedBursaFeedAdapter', provenanceClass: ProvenanceClass.Real },
    ]);
    expect(landedInto).toEqual(['run-1']);
    expect(outcome).toEqual({ runId: 'run-1', value: 3, failures: [] });
  });

  it('returns the fetch failures as the failure summary', async () => {
    const { manager } = fakeManager();
    const outcome = await runs.run(manager, licensedFeed, async () => ({
      value: null,
      failures: ['1155: timeout', '5347: 429'],
    }));
    expect(outcome.failures).toEqual(['1155: timeout', '5347: 429']);
  });

  it('opens a SyntheticRun carrying seed + params when the adapter declares a seeded generation', async () => {
    const { manager, standard, synthetic } = fakeManager();
    const coGenerator: SourceAdapter = {
      adapterName: 'SyntheticMarketDataAdapter',
      provenanceClass: ProvenanceClass.Synthetic,
      generation: { seed: 42, params: { drift: 0.1 } },
    };

    const outcome = await runs.run(manager, coGenerator, async () => ({
      value: undefined,
      failures: [],
    }));

    expect(standard).toEqual([]);
    expect(synthetic).toEqual([
      expect.objectContaining({
        adapter: 'SyntheticMarketDataAdapter',
        provenanceClass: ProvenanceClass.Synthetic,
        seed: '42',
        params: { drift: 0.1 },
      }),
    ]);
    expect(outcome.runId).toBe('synthetic-1');
  });

  it('refuses a seeded generation on a non-synthetic adapter', async () => {
    const { manager } = fakeManager();
    await expect(
      runs.run(
        manager,
        { ...licensedFeed, generation: { seed: 1, params: {} } },
        async () => ({ value: undefined, failures: [] }),
      ),
    ).rejects.toThrow(/declares a seeded generation/);
  });
});
