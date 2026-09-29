/**
 * correlationId plumbing (ADR-0007 §2, ADR-0010 §3).
 *
 * The `correlationId` is the cross-service stitch key: NestJS stamps it from the
 * request (or mints one), every log line MUST carry it (ADR-0010 §3), and it is
 * passed into the JobEnvelope so the Python worker can stamp it on every line it
 * emits for that job.
 */

/** Header the FE may send to correlate a request; NestJS mints one if absent. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Log/context field name — mandatory on every log line (ADR-0010 §3). */
export const CORRELATION_ID_FIELD = 'correlationId';
