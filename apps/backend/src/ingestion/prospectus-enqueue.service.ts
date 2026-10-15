/**
 * Prospectus analysis ops enqueue (spec 06, ticket 05).
 *
 * The manual ops action behind the `enqueue-prospectus` worker command
 * (`worker-main.ts`): enqueues a system-triggered `analyze-prospectus` job for
 * curated `IpoListing` rows. NOT a cron — a handful of manually-curated rows
 * (map decision, spec 06); the ticket-04 corpus is seeded by `seed-prospectus`.
 *
 * COST BOUNDING (the explicit not-yet-processed predicate): a listing is
 * eligible only when `prospectus_s3_key IS NOT NULL` AND no `prospectus_analyses`
 * row exists for it. BullMQ's content-derived job id (`prospectus-{id}`) does
 * NOT bound cost on its own — completed jobs are retained only 1h — so this
 * predicate is what makes repeated runs idempotent (ticket-03 learning). Naming
 * one id re-runs that listing even if already analysed (explicit intent; the
 * parse is reused so a re-run is mostly LLM spend).
 *
 * Trigger is `system`/`requestedBy: 'system'`: a trusted internal caller that
 * bypasses the tier gate (ADR-0005) — no `req.user` exists here.
 */

import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { JobEnvelope, ProspectusPayload } from '@tuju/contracts';
import { IpoListing } from '../data/entities/ipo-listing.entity';
import { JobBus } from '../jobbus/job-bus.service';
import { JobNames } from '../jobbus/job-names';
import { isUuid } from '../stocks/filters';

export interface ProspectusEnqueueResult {
  /** Listing ids an `analyze-prospectus` job was enqueued for. */
  enqueued: string[];
  /** Eligible ids skipped because the same job is already waiting/active/delayed. */
  alreadyInFlight: string[];
}

/** System-triggered envelope for one prospectus (pure; unit-tested). */
export function buildProspectusEnvelope(
  prospectusId: string,
  now: Date = new Date(),
): JobEnvelope<ProspectusPayload> {
  return {
    correlationId: randomUUID(),
    requestedBy: 'system',
    trigger: 'system',
    asOf: now.toISOString(),
    payload: { prospectusId },
  };
}

@Injectable()
export class ProspectusEnqueueService {
  private readonly logger = new Logger(ProspectusEnqueueService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly jobBus: JobBus,
  ) {}

  /**
   * The not-yet-processed predicate: curated (has a stored PDF) and no
   * analysis row yet. Ordered for deterministic output.
   */
  async selectUnanalysedIds(): Promise<string[]> {
    const rows = await this.dataSource
      .getRepository(IpoListing)
      .createQueryBuilder('l')
      .select('l.id', 'id')
      .where('l.prospectus_s3_key IS NOT NULL')
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM prospectus_analyses a WHERE a.prospectus_id = l.id)`,
      )
      .orderBy('l.company_name', 'ASC')
      .addOrderBy('l.id', 'ASC')
      .getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  /**
   * Enqueue for every unanalysed curated row, or — when `onlyId` is given —
   * for that one listing regardless of analysis state (re-run). Throws for an
   * `onlyId` that is malformed, unknown, or has no `prospectusS3Key`.
   */
  async enqueue(onlyId?: string): Promise<ProspectusEnqueueResult> {
    let ids: string[];
    if (onlyId !== undefined) {
      const listing = isUuid(onlyId)
        ? await this.dataSource
            .getRepository(IpoListing)
            .findOne({ where: { id: onlyId } })
        : null;
      if (!listing) throw new Error(`enqueue-prospectus: no IpoListing with id=${onlyId}`);
      if (!listing.prospectusS3Key) {
        throw new Error(
          `enqueue-prospectus: IpoListing ${onlyId} has no prospectusS3Key (run seed-prospectus)`,
        );
      }
      ids = [listing.id];
    } else {
      ids = await this.selectUnanalysedIds();
    }

    const result: ProspectusEnqueueResult = { enqueued: [], alreadyInFlight: [] };
    for (const id of ids) {
      // A retained COMPLETED (1h) or FAILED (24h) job would otherwise turn a
      // legitimate retry/re-run into a silent no-op, so finished ones are
      // replaced; a genuinely in-flight one collapses (that dedup is intended).
      const { status } = await this.jobBus.enqueue(
        JobNames.prospectus,
        buildProspectusEnvelope(id),
        { replaceFinished: true },
      );
      if (status === 'inFlight') result.alreadyInFlight.push(id);
      else result.enqueued.push(id);
    }
    this.logger.log({ msg: 'enqueue-prospectus done', ...result });
    return result;
  }
}
