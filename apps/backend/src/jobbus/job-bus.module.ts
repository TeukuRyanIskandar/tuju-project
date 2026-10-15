import { Module } from '@nestjs/common';
import { BullMqJobBus } from './bullmq-job-bus';
import { JobBus } from './job-bus.service';
import { StubJobWorker } from './stub-job.worker';

/**
 * The production `JobBus` binding: the abstract seam resolves to the BullMQ
 * adapter (one instance, also reachable by its own class for Bull-Board).
 * Exported so testing modules can wire the same binding.
 */
export const JOB_BUS_PROVIDERS = [
  BullMqJobBus,
  { provide: JobBus, useExisting: BullMqJobBus },
];

/**
 * JobBus module (ADR-0001/0007). Exports the `JobBus` seam so app code enqueues
 * jobs without touching BullMQ directly. The stub worker is scaffold-only.
 */
@Module({
  providers: [...JOB_BUS_PROVIDERS, StubJobWorker],
  exports: [JobBus, BullMqJobBus],
})
export class JobBusModule {}
