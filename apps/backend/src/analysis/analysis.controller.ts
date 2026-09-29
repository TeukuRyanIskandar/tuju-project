import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { JobEnvelope, TechnicalPayload } from '@tuju/contracts';
import { JobNames } from '../jobbus/job-names';
import { JobBus } from '../jobbus/job-bus.service';
import { RequiresJob } from '../auth/requires-job.decorator';
import { CORRELATION_ID_FIELD } from '../observability/correlation-id';
import { AnalysisResultStore } from './analysis-result.store';

/**
 * SCAFFOLD analysis surface (ticket 06 round-trip proof, ADR-0001/0004/0007).
 *
 * This is the FE-facing seam that makes the compose round-trip observable:
 *   POST /analysis  → JobBus.enqueue (gated by @RequiresJob, ADR-0005)
 *   GET  /analysis/:correlationId → read the persisted result (claim-check
 *                                   pointer + thin summary, ADR-0004 §4)
 *
 * No product/TA logic lives here — it only wires the existing JobBus seam to an
 * HTTP surface so `docker compose up` can be verified end to end. The real
 * consumer is the Python worker (services/ai); the persisted row is written by
 * the AnalysisResultStore subscriber (NestJS is the sole Postgres writer).
 */
@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly jobBus: JobBus,
    private readonly store: AnalysisResultStore,
  ) {}

  /**
   * Enqueue a technical-analysis job. Gated by @RequiresJob so the ADR-0005
   * capability seam is exercised (a `pro`/`premium` session is required).
   */
  @Post()
  @RequiresJob('analyze-technical')
  async enqueue(
    @Req() req: Request & { id?: string },
    @Body() body: { symbol?: string; timeframe?: string },
  ): Promise<{ correlationId: string; jobId: string }> {
    // The correlationId is the request id minted by pino-http (ADR-0010 §3),
    // reused as the cross-service stitch key passed into the envelope.
    const correlationId = String(req.id ?? '');
    const payload: TechnicalPayload = {
      symbol: body.symbol ?? 'MAYBANK',
      timeframe: (body.timeframe as TechnicalPayload['timeframe']) ?? '1D',
    };
    const envelope: JobEnvelope<TechnicalPayload> = {
      correlationId,
      requestedBy: 'compose-smoke',
      trigger: 'user',
      asOf: new Date().toISOString(),
      payload,
    };
    const { jobId } = await this.jobBus.enqueue(JobNames.technical, envelope);
    return { correlationId, jobId };
  }

  /** Read the persisted result for a correlationId (FE poll / proxy read). */
  @Get(':correlationId')
  async read(@Param('correlationId') correlationId: string) {
    const row = await this.store.findByCorrelationId(correlationId);
    if (!row) {
      throw new NotFoundException(
        `No analysis result yet for ${CORRELATION_ID_FIELD}=${correlationId}`,
      );
    }
    return row;
  }
}
