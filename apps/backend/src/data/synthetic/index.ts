/**
 * Synthetic co-generation generator (spec 01, decision A1, ticket 03).
 *
 * A pure, deterministic, seeded module that co-produces the reconciled 3-year
 * timeline (price bars + quarterly financials + dividends) plus the derived
 * fundamentals snapshot, as plain DTOs matching the entity field shapes. No
 * TypeORM/DB access — persistence is ticket 04's job.
 */
export { generate } from './generator';
export * as ratios from './ratios';
export {
  DEFAULT_PARAMS,
  SCALE,
  type CorporateActionDto,
  type FundamentalsSnapshotDto,
  type PriceBarDto,
  type QuarterlyFinancialsDto,
  type SyntheticDataset,
  type SyntheticParams,
} from './types';
