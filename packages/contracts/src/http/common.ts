import { z } from 'zod';

/**
 * Shared building blocks for the backend read endpoints' HTTP response schemas
 * (ADR-0014).
 *
 * These schemas are NOT registered for the Python codegen: no `.meta({ id })`,
 * and none of them belongs in `modelOrder` (`buildJsonSchema` serializes the
 * whole global registry, so an accidental `.meta({ id })` would leak them).
 *
 * Objects are `strictObject`: an unknown key fails validation, so a backend
 * field added without a contract change is caught by dev/test response
 * validation instead of being silently stripped.
 */

/** Licence-boundary class of the ingestion run a row came from. */
export const ProvenanceClass = z.enum(['synthetic', 'aggregator', 'real']);
export type ProvenanceClass = z.infer<typeof ProvenanceClass>;

/** Listing board. `LEAP` only appears on reference/IPO rows, never in analysis. */
export const ListingBoard = z.enum(['MAIN', 'ACE', 'LEAP']);
export type ListingBoard = z.infer<typeof ListingBoard>;

export const AnnouncementCategory = z.enum([
  'FINANCIAL_RESULTS',
  'ENTITLEMENT',
  'SHAREHOLDING_CHANGE',
  'GENERAL',
  'ADDITIONAL_LISTING',
  'MEETING',
  'CIRCULAR',
  'ANNUAL_REPORT',
  'LISTING',
  'OTHER',
]);
export type AnnouncementCategory = z.infer<typeof AnnouncementCategory>;

export const CorporateActionType = z.enum(['DIVIDEND', 'BONUS', 'SPLIT', 'RIGHTS']);
export type CorporateActionType = z.infer<typeof CorporateActionType>;

/** SC Shariah-list compliance verdict. */
export const ShariahStatus = z.enum(['COMPLIANT', 'NON_COMPLIANT']);
export type ShariahStatus = z.infer<typeof ShariahStatus>;

/** `YYYY-MM-DD` calendar date (Postgres `date` columns, served as stored). */
export const IsoDate = z.iso.date();

/** ISO-8601 instant (`timestamptz` columns, served via `toISOString()`). */
export const IsoDateTime = z.iso.datetime();

/** One provenance descriptor per data block / row (the illustrative-label source). */
export const provenanceShape = { provenance: ProvenanceClass } as const;

/**
 * Shared pagination envelope; the resolved offset/limit are echoed back.
 * `Page(ItemSchema)` builds the envelope for one item schema.
 */
export const Page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    total: z.number().int().min(0),
    offset: z.number().int().min(0),
    limit: z.number().int().min(0),
  });
export type Page<T> = {
  items: T[];
  total: number;
  offset: number;
  limit: number;
};
