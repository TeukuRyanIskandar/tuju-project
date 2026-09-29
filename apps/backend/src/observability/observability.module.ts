import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import {
  CORRELATION_ID_FIELD,
  CORRELATION_ID_HEADER,
} from './correlation-id';

/**
 * Structured JSON logging to stdout (ADR-0010 §1/§2).
 *
 * - App owns log CONTENT (structured JSON); the runtime owns TRANSPORT (Docker
 *   json-file driver). No files, no hand-rolled text format.
 * - `correlationId` is a MANDATORY field on every log line (ADR-0010 §3): pino-http
 *   derives it from the incoming request (minting a UUID when absent) and binds it
 *   to the per-request child logger so every line for that request carries it.
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        // Pretty printing is a transport concern and is deliberately NOT enabled
        // here — stdout is always machine-readable JSON (ADR-0010 §1).
        level: process.env.LOG_LEVEL ?? 'info',
        // Mint/propagate the correlationId and expose it on the response so the
        // FE can subscribe to progress/result/failure for it (ADR-0007 §2).
        genReqId(
          req: IncomingMessage,
          res: ServerResponse,
        ): string {
          const incoming = req.headers[CORRELATION_ID_HEADER];
          const correlationId =
            (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
          res.setHeader(CORRELATION_ID_HEADER, correlationId);
          return correlationId;
        },
        // The generated request id IS the correlationId — surface it under the
        // mandatory field name on every line (ADR-0010 §3).
        customProps(req: IncomingMessage) {
          return {
            [CORRELATION_ID_FIELD]: (req as IncomingMessage & { id?: unknown })
              .id,
          };
        },
        // Drop the noisy default req/res serializers to keep lines lean; the
        // correlationId + method/url/status is enough for warm-500 breadcrumbs.
        serializers: {
          req(req: { method: string; url: string }) {
            return { method: req.method, url: req.url };
          },
        },
      },
    }),
  ],
})
export class ObservabilityModule {}
