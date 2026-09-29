import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AnalysisResult } from './entities/analysis-result.entity';
import { InitialSchema1727600000000 } from './migrations/1727600000000-InitialSchema';

/**
 * Data layer (ADR-0004): Postgres + TypeORM via @nestjs/typeorm, reached by
 * DATABASE_URL (ADR-0006). NestJS is the sole Postgres writer.
 *
 * `synchronize` is OFF — schema is owned by explicit migrations. Entities are
 * registered here (not in packages/contracts): the DB schema and the
 * cross-language wire contract are distinct concerns (ADR-0004 §1).
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        type: 'postgres' as const,
        url: config.databaseUrl,
        synchronize: false,
        autoLoadEntities: true,
        entities: [AnalysisResult],
        migrations: [InitialSchema1727600000000],
      }),
    }),
    TypeOrmModule.forFeature([AnalysisResult]),
  ],
  exports: [TypeOrmModule],
})
export class DataModule {}
