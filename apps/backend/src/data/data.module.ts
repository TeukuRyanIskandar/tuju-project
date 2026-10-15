import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

/**
 * Data layer (ADR-0004): Postgres + TypeORM via @nestjs/typeorm, reached by
 * DATABASE_URL (ADR-0006). NestJS is the sole Postgres writer.
 *
 * `synchronize` is OFF — schema is owned by explicit migrations. Database
 * connection setup is managed here. The connection registers the full
 * consolidated `ENTITIES` array (same as `data-source.ts`): TypeORM needs
 * metadata for every entity reachable through relations (e.g. Company#sector),
 * and several feature modules (search, screener, disclosures, market,
 * ingestion) query through the DataSource without a forFeature() declaration.
 * Per-feature TypeOrmModule.forFeature() declarations still provide their
 * injectable repositories.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        type: 'postgres' as const,
        url: config.databaseUrl,
        synchronize: false,
        entities: ENTITIES,
        autoLoadEntities: true,
        migrations: MIGRATIONS,
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DataModule {}
