import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/config';
import { applyCors } from './config/cors';
import { JobBus } from './jobbus/job-bus.service';
import { BULL_BOARD_PATH, createBullBoardRouter } from './jobbus/bull-board';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Structured JSON logging to stdout with mandatory correlationId (ADR-0010).
  app.useLogger(app.get(Logger));

  // Parse cookies so AuthGuard can read the opaque session cookie (ADR-0005).
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = app.get<AppConfig>(APP_CONFIG);

  // Credentialed CORS for the allowlisted SPA origin(s) only (ADR-0005).
  applyCors(app, config.corsOrigins);

  // Bull Board queue-introspection route (ADR-0010 §4).
  const jobBus = app.get(JobBus);
  app.use(BULL_BOARD_PATH, createBullBoardRouter(jobBus.getQueue()));

  await app.listen(config.port);
}

void bootstrap();
