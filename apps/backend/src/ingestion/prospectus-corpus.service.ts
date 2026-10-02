/**
 * Prospectus corpus seeder (spec 06, ticket 04).
 *
 * The one-shot ops action that puts the curated demo corpus (three real
 * prospectus PDFs, `prospectus-corpus.ts`) where the flagship pipeline needs
 * it: each PDF is uploaded to the artifacts bucket under
 * `prospectus/{fileName}`, and an `IpoListing` row is upserted with
 * `prospectusS3Key` set so ticket 05's `analyze-prospectus` job (and its
 * ops enqueue path) can find it. Runs as the `seed-prospectus` worker
 * command (`worker-main.ts`), NOT a cron — a handful of manually-curated
 * rows (map decision, spec 06).
 *
 * Idempotent (the ticket-04 acceptance shape): S3 writes are PUTs to
 * deterministic keys (same bytes, same key), and the `IpoListing` persist is
 * an upsert on the natural key `(companyName, listingDate)` — a re-seed
 * updates in place, never duplicates.
 *
 * Provenance is `real` (stored regulatory PDFs) — the corpus the spec-06
 * flagship artifact stands on; it survives the decision-B licence-boundary
 * purge. ADR-0004 sole-writer holds: this is the NestJS process writing
 * Postgres.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DataSource } from 'typeorm';
import { S3_OPTIONS, S3_CLIENT, type S3Options } from '../s3/s3.module';
import { IpoListing } from '../data/entities/ipo-listing.entity';
import { ProvenanceClass } from '../data/entities/enums';
import { IngestionRunService } from './ingestion-run.service';
import { PROSPECTUS_CORPUS } from './prospectus-corpus';

/** Summary of one seed run (returned for tests / logging). */
export interface ProspectusSeedResult {
  uploaded: number;
  ipoListings: number;
}

/** Adapter name stamped on the `IngestionRun` lineage rows this seeder opens. */
export const PROSPECTUS_CORPUS_ADAPTER = 'CuratedProspectusCorpusAdapter';

@Injectable()
export class ProspectusCorpusService {
  private readonly logger = new Logger(ProspectusCorpusService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly runs: IngestionRunService,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(S3_OPTIONS) private readonly s3Options: S3Options,
  ) {}

  /**
   * Seed the corpus from `corpusDir` (the demo corpus directory holding the
   * stored PDFs). Uploads every PDF first (deterministic keys make the PUTs
   * idempotent), then upserts the `IpoListing` rows in one transaction under
   * a `real`-provenance run.
   */
  async seedProspectusCorpus(
    corpusDir: string,
  ): Promise<ProspectusSeedResult> {
    const dir = resolve(corpusDir);

    // Fail fast on a missing corpus BEFORE any S3/DB write lands.
    const bodies = new Map<string, Buffer>();
    for (const item of PROSPECTUS_CORPUS) {
      const body = await readFile(join(dir, item.fileName));
      if (body.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new Error(
          `seedProspectusCorpus: ${item.fileName} is not a PDF (missing %PDF- magic)`,
        );
      }
      bodies.set(item.fileName, body);
    }

    for (const item of PROSPECTUS_CORPUS) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.s3Options.bucket,
          Key: item.prospectusS3Key,
          Body: bodies.get(item.fileName),
          ContentType: 'application/pdf',
        }),
      );
      this.logger.log(
        `uploaded ${item.prospectusS3Key} (${bodies.get(item.fileName)!.length} bytes)`,
      );
    }

    const ipoListings = await this.dataSource.transaction(async (manager) => {
      const run = await this.runs.openRun(
        manager,
        PROSPECTUS_CORPUS_ADAPTER,
        ProvenanceClass.Real,
      );
      const repo = manager.getRepository(IpoListing);
      const rows = PROSPECTUS_CORPUS.map((item) =>
        repo.create({
          companyName: item.companyName,
          board: item.board,
          listingDate: item.listingDate,
          offerPrice: item.offerPrice.toFixed(6),
          prospectusS3Key: item.prospectusS3Key,
          ingestionRunId: run.id,
        }),
      );
      // Upsert on the natural key — a re-seed updates in place (idempotent).
      await repo.upsert(rows, ['companyName', 'listingDate']);
      return rows.length;
    });

    const uploaded = PROSPECTUS_CORPUS.length;
    this.logger.log(
      `seeded ${uploaded} prospectus PDFs and ${ipoListings} IPO rows from ${dir}`,
    );
    return { uploaded, ipoListings };
  }
}
