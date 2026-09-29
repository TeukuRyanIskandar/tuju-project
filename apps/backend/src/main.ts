import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/config';
import { JobBus } from './jobbus/job-bus.service';
import { BULL_BOARD_PATH, createBullBoardRouter } from './jobbus/bull-board';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Structured JSON logging to stdout with mandatory correlationId (ADR-0010).
  app.useLogger(app.get(Logger));

  // Parse cookies so AuthGuard can read the opaque session cookie (ADR-0005).
  app.use(cookieParser());

  // Bull Board queue-introspection route (ADR-0010 §4).
  const jobBus = app.get(JobBus);
  app.use(BULL_BOARD_PATH, createBullBoardRouter(jobBus.getQueue()));

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port);
}

void bootstrap();
