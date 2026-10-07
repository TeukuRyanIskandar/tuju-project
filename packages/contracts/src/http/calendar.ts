import { z } from 'zod';
import {
  CorporateActionType,
  IsoDate,
  IsoDateTime,
  provenanceShape,
} from './common.js';
import { CompanyCode } from './disclosures.js';

/** `GET /calendar/corporate-actions` and `GET /calendar/results` (spec 04). */

export const CorporateActionCalendarItem = z.strictObject({
  ...provenanceShape,
  companyCode: CompanyCode,
  companyName: z.string(),
  type: CorporateActionType,
  exDate: IsoDate,
  amount: z.number().nullable(),
});
export type CorporateActionCalendarItem = z.infer<typeof CorporateActionCalendarItem>;

/** The resolved inclusive window is echoed back. */
export const CorporateActionCalendarWindow = z.strictObject({
  from: IsoDate,
  to: IsoDate,
  items: z.array(CorporateActionCalendarItem),
});
export type CorporateActionCalendarWindow = z.infer<typeof CorporateActionCalendarWindow>;

/** One results-calendar row: when a company filed quarterly results. */
export const ResultsCalendarItem = z.strictObject({
  ...provenanceShape,
  companyCode: CompanyCode,
  companyName: z.string(),
  fiscalYear: z.number().int(),
  /** Fiscal quarter 1-4. */
  fiscalQuarter: z.number().int().min(1).max(4),
  periodEnd: IsoDate,
  reportedAt: IsoDateTime,
  /** The underlying FINANCIAL_RESULTS disclosure. */
  announcement: z.strictObject({
    title: z.string(),
    filedAt: IsoDateTime,
    sourceUrl: z.string().nullable(),
  }),
});
export type ResultsCalendarItem = z.infer<typeof ResultsCalendarItem>;

/** The applied `reportedAt` filter is echoed back (null when unfiltered). */
export const ResultsCalendarWindow = z.strictObject({
  from: IsoDate.nullable(),
  to: IsoDate.nullable(),
  items: z.array(ResultsCalendarItem),
});
export type ResultsCalendarWindow = z.infer<typeof ResultsCalendarWindow>;
