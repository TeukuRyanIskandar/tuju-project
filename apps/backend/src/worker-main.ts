import 'reflect-metadata';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';
import { EodIngestService } from './ingestion/eod-ingest.service';
import { IntradayReplayService } from './ingestion/intraday-replay.service';
import { PurgeService } from './ingestion/purge.service';
import { ProspectusCorpusService } from './ingestion/prospectus-corpus.service';
import { ProspectusEnqueueService } from './ingestion/prospectus-enqueue.service';
import { DEFAULT_PROSPECTUS_CORPUS_DIR } from './ingestion/prospectus-corpus';

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
 *   - `ingest`          run one nightly EOD + fundamentals + indicators ingest now
 *   - `intraday`        replay one intraday tick into Redis now
 *   - `purge`           run the decision-B licence-boundary purge
 *   - `seed-prospectus` upload the curated prospectus corpus PDFs to S3 and
 *                       upsert their `IpoListing` rows (spec 06, ticket 04; an
 *                       ops action over a handful of manually-curated rows, not
 *                       a cron — map decision). Optional arg: the corpus
 *                       directory (default: the repo's demo corpus, or
 *                       PROSPECTUS_CORPUS_DIR).
 *   - `enqueue-prospectus` enqueue a system-triggered `analyze-prospectus` job
 *                       for every curated `IpoListing` that has a
 *                       `prospectusS3Key` and NO `prospectus_analyses` row yet
 *                       (spec 06, ticket 05; the not-yet-processed predicate
 *                       that bounds AI cost — safe to re-run, a second run
 *                       enqueues nothing once results have landed). Not a cron.
 *                       Optional arg: an `IpoListing.id` (uuid) to (re-)run just
 *                       that one even if already analysed; `--force <id>` is
 *                       accepted as the same thing. Needs the `ai-worker` to be
 *                       running and `seed-prospectus` to have been run first.
 *   - `serve` (default) register the crons and stay resident
 *
 * Usage: `node dist/worker-main.js [command] [args...]`.
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
    case 'seed-prospectus': {
      const corpusDir = resolve(
        process.argv[3] ??
          process.env.PROSPECTUS_CORPUS_DIR ??
          DEFAULT_PROSPECTUS_CORPUS_DIR,
      );
      const result = await app
        .get(ProspectusCorpusService)
        .seedProspectusCorpus(corpusDir);
      logger.log(
        { command, corpusDir, result },
        'worker.command.seed-prospectus.done',
      );
      await app.close();
      return;
    }
    case 'enqueue-prospectus': {
      // `enqueue-prospectus [id]` or `enqueue-prospectus --force <id>`.
      const args = process.argv.slice(3).filter((a) => a !== '--force');
      const result = await app.get(ProspectusEnqueueService).enqueue(args[0]);
      logger.log({ command, result }, 'worker.command.enqueue-prospectus.done');
      // Give BullMQ's connection a beat to flush before the context closes.
      await app.close();
      return;
    }
    case 'serve':
    default: {
      // `createApplicationContext` above already initialises the context and
      // registers the @nestjs/schedule crons — no second app.init() needed.
      logger.log({ command: 'serve' }, 'worker.serve.crons-registered');
      // Keep the process resident so scheduled jobs fire.
      return;
    }
  }
}

void bootstrap();
