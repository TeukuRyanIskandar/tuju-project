import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { Queue } from 'bullmq';

/** Mount path for the Bull Board queue-introspection UI (ADR-0010 §4). */
export const BULL_BOARD_PATH = '/admin/queues';

/**
 * Bull Board route (ADR-0010 §4): surfaces BullMQ introspection (queue depth,
 * active/failed/completed counts, DLQ size) so the ADR-0007 retry/backoff/DLQ
 * behaviour and failure classes are observable without a metrics backend.
 *
 * Returns the Express router to mount at {@link BULL_BOARD_PATH}. In prod this
 * route must sit behind admin auth — noted, not wired at scaffold time.
 */
export function createBullBoardRouter(queue: Queue) {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({
    queues: [new BullMQAdapter(queue)],
    serverAdapter,
  });
  return serverAdapter.getRouter();
}
