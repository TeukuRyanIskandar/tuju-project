import { Module } from '@nestjs/common';
import { JobBus } from './job-bus.service';
import { StubJobWorker } from './stub-job.worker';

/**
 * JobBus module (ADR-0001/0007). Exports the `JobBus` seam so app code enqueues
 * jobs without touching BullMQ directly. The stub worker is scaffold-only.
 */
@Module({
  providers: [JobBus, StubJobWorker],
  exports: [JobBus],
})
export class JobBusModule {}
