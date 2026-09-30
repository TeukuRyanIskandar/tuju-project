import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';
import { EodIngestService } from './ingestion/eod-ingest.service';
import { IntradayReplayService } from './ingestion/intraday-replay.service';
import { PurgeService } from './ingestion/purge.service';

/**
 * Ingestion worker entrypoint (spec 01 process shape; ticket 04, ADR-0012).
 *
 * The **second NestJS process**, booted headless via
 * `NestFactory.createApplicationContext` (no HTTP server) from the SAME
 * `apps/backend` image and TypeORM entities/migrations/DB connection as the API.
 * On boot the `@nestjs/schedule` crons in {@link IngestionModule} register and the
 * process stays alive to fire them — the default `serve` mode.
 *
 * It also supports one-shot commands (bootstrap the context, run, exit), used for
 * manual/operational tasks the spec keeps off a cron:
 *   - `ingest`        run one nightly EOD + fundamentals + indicators ingest now
 *   - `intraday`      replay one intraday tick into Redis now
 *   - `purge`         run the decision-B licence-boundary purge
 *   - `serve` (default) register the crons and stay resident
 *
 * Usage: `node dist/worker-main.js [command]`.
 */
async function bootstrap(): Promise<void> {
  const command = process.argv[2] ?? 'serve';
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  const logger = app.get(Logger);

  switch (command) {
    case 'ingest': {
      const result = await app.get(EodIngestService).runNightly();
      logger.log({ command, result }, 'worker.command.ingest.done');
      await app.close();
      return;
    }
    case 'intraday': {
      const ticks = await app.get(IntradayReplayService).replayTick();
      logger.log({ command, ticks: ticks.length }, 'worker.command.intraday.done');
      await app.close();
      return;
    }
    case 'purge': {
      const result = await app.get(PurgeService).purgeUnlicensed();
      logger.log({ command, result }, 'worker.command.purge.done');
      await app.close();
      return;
    }
    case 'serve':
    default: {
      // Crons registered by ScheduleModule in IngestionModule are now live.
      logger.log({ command: 'serve' }, 'worker.serve.crons-registered');
      await app.init();
      // Keep the process resident so scheduled jobs fire.
      return;
    }
  }
}

void bootstrap();
