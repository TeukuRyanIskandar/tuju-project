import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

/**
 * Standalone TypeORM DataSource used by the CLI (migration:run/revert).
 *
 * Reached by DATABASE_URL (ADR-0006). `synchronize` is OFF — schema changes go
 * through explicit migrations only, keeping NestJS the deliberate, sole writer
 * of the schema as well as the data (ADR-0004 §2).
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  synchronize: false,
  logging: false,
  entities: ENTITIES,
  migrations: MIGRATIONS,
});
