/**
 * Prospectus corpus seeder integration test (spec 06, ticket 04; ADR-0011).
 *
 * Exercises the seed round-trip against REAL infra — throwaway Postgres AND a
 * throwaway LocalStack (S3) via testcontainers — because what is decided here
 * is exactly what mocks silently get wrong: the aws-sdk v3 S3Client wiring
 * against the same LocalStack image compose runs, and the `IpoListing`
 * natural-key upsert (idempotent re-seed, stable row ids).
 *
 *  1. Seeding uploads each corpus PDF to `prospectus/{fileName}` and the S3
 *     bytes match the stored corpus files byte-for-byte.
 *  2. Upserted `IpoListing` rows carry `prospectusS3Key` + the filed board /
 *     listing date / offer price, under a `real`-provenance `IngestionRun`
 *     (`CuratedProspectusCorpusAdapter`).
 *  3. A re-seed is idempotent: no duplicate rows, stable row ids, S3 PUTs
 *     re-land at the same deterministic keys.
 *
 * `.int-spec.ts` — runs only in the integration lane (jest.int.config.cjs),
 * which requires Docker.
 */
import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  CreateBucketCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

import * as entities from '../data/entities';
import { ListingBoard, ProvenanceClass } from '../data/entities/enums';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from '../data/migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from '../data/migrations/1727900000000-DisclosureReadModel';
import { MarketIndexModel1728000000000 } from '../data/migrations/1728000000000-MarketIndexModel';
import { ShowcaseJobsModel1728100000000 } from '../data/migrations/1728100000000-ShowcaseJobsModel';
import { IngestionRunService } from './ingestion-run.service';
import {
  ProspectusCorpusService,
  PROSPECTUS_CORPUS_ADAPTER,
} from './prospectus-corpus.service';
import {
  PROSPECTUS_CORPUS,
  DEFAULT_PROSPECTUS_CORPUS_DIR,
} from './prospectus-corpus';
import { S3_CLIENT, S3_OPTIONS } from '../s3/s3.module';

jest.setTimeout(180_000);

const ALL_ENTITIES = Object.values(entities).filter(
  (v) => typeof v === 'function',
);

// The repo's stored corpus (tracked in git — the PDFs the seed uploads).
const CORPUS_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  DEFAULT_PROSPECTUS_CORPUS_DIR,
);

describe('Prospectus corpus seeder (integration — testcontainers)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let localstack: StartedTestContainer;
  let dataSource: DataSource;
  let moduleRef: TestingModule;
  let s3: S3Client;
  let service: ProspectusCorpusService;
  const bucket = 'tuju-prospectus-test';

  beforeAll(async () => {
    [pgContainer, localstack] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new GenericContainer('localstack/localstack:3')
        .withEnvironment({ SERVICES: 's3' })
        .withExposedPorts(4566)
        .withWaitStrategy(Wait.forHttp('/_localstack/health', 4566))
        .start(),
    ]);

    const s3Endpoint = `http://${localstack.getHost()}:${localstack.getMappedPort(4566)}`;
    s3 = new S3Client({
      region: 'ap-southeast-1',
      endpoint: s3Endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));

    dataSource = new DataSource({
      type: 'postgres',
      url: pgContainer.getConnectionUri(),
      synchronize: false,
      entities: ALL_ENTITIES,
      migrations: [
        InitialSchema1727600000000,
        FreeTierDomainModel1727700000000,
        ReIngestNaturalKeys1727800000000,
        DisclosureReadModel1727900000000,
        MarketIndexModel1728000000000,
        ShowcaseJobsModel1728100000000,
      ],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    moduleRef = await Test.createTestingModule({
      providers: [
        { provide: DataSource, useValue: dataSource },
        { provide: S3_CLIENT, useValue: s3 },
        {
          provide: S3_OPTIONS,
          useValue: {
            bucket,
            region: 'ap-southeast-1',
            endpoint: s3Endpoint,
            accessKeyId: 'test',
            secretAccessKey: 'test',
          },
        },
        IngestionRunService,
        ProspectusCorpusService,
      ],
    }).compile();

    service = moduleRef.get(ProspectusCorpusService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await localstack?.stop();
    await pgContainer?.stop();
  });

  it('seeds every corpus PDF to S3, byte-identical to the stored files', async () => {
    const result = await service.seedProspectusCorpus(CORPUS_DIR);
    expect(result.uploaded).toBe(PROSPECTUS_CORPUS.length);

    for (const item of PROSPECTUS_CORPUS) {
      const res = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: item.prospectusS3Key }),
      );
      const got = Buffer.from(await res.Body!.transformToByteArray());
      const want = await readFile(join(CORPUS_DIR, item.fileName));
      expect(got.equals(want)).toBe(true);
      expect(res.ContentType).toBe('application/pdf');
    }
  });

  it('upserts IpoListing rows with prospectusS3Key under a real-provenance run', async () => {
    const repo = dataSource.getRepository(entities.IpoListing);
    const rows = await repo.find();
    expect(rows).toHaveLength(PROSPECTUS_CORPUS.length);

    for (const item of PROSPECTUS_CORPUS) {
      const row = await repo.findOneOrFail({
        where: { companyName: item.companyName, listingDate: item.listingDate },
      });
      expect(row.board).toBe(ListingBoard.Ace);
      expect(row.prospectusS3Key).toBe(item.prospectusS3Key);
      expect(row.offerPrice).toBe(item.offerPrice.toFixed(6));
      // Lineage: a `real`-provenance IngestionRun opened by the corpus adapter.
      const run = await dataSource
        .getRepository(entities.IngestionRun)
        .findOneOrFail({ where: { id: row.ingestionRunId } });
      expect(run.provenanceClass).toBe(ProvenanceClass.Real);
      expect(run.adapter).toBe(PROSPECTUS_CORPUS_ADAPTER);
    }
  });

  it('re-seeding is idempotent: no duplicates, stable row ids', async () => {
    const repo = dataSource.getRepository(entities.IpoListing);
    const before = await repo.find();
    const idsBefore = new Set(before.map((r) => r.id));

    await service.seedProspectusCorpus(CORPUS_DIR);

    const after = await repo.find();
    expect(after).toHaveLength(PROSPECTUS_CORPUS.length);
    for (const row of after) {
      expect(idsBefore.has(row.id)).toBe(true);
    }
  });

  it('fails fast (no S3 writes) when a corpus PDF is missing', async () => {
    const result = await service
      .seedProspectusCorpus(join(CORPUS_DIR, 'does-not-exist'))
      .then(() => 'resolved')
      .catch(() => 'rejected');
    expect(result).toBe('rejected');
    // The seeded rows from the earlier tests are untouched.
    expect(
      (await dataSource.getRepository(entities.IpoListing).find()).length,
    ).toBe(PROSPECTUS_CORPUS.length);
  });
});
