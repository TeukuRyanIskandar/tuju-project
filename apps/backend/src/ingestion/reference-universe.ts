/**
 * Demo reference universe (spec 01, ticket 04).
 *
 * A small, curated set of `real`-provenance reference rows — Bursa sectors,
 * listed companies and their ordinary-share instruments — that the synthetic
 * price/fundamentals adapters generate against. Reference data is public
 * (Company/Instrument/Sector are `real`, ADR: they survive the decision-B purge);
 * only the price bars, quarterly financials, indicator and fundamentals snapshots
 * co-generated for them carry `synthetic` provenance.
 *
 * `stockCode` is the stable natural key the seam's DTOs are keyed on, and the
 * per-instrument generator seed is derived from it so the reconciled timeline is
 * reproducible per instrument.
 */

import { ListingBoard } from '../data/entities/enums';

/** A curated demo company + its single ordinary-share instrument. */
export interface ReferenceCompany {
  /** Bursa 4-digit code (natural key for the instrument + all sourced rows). */
  readonly stockCode: string;
  readonly shortName: string;
  readonly fullName: string;
  readonly board: ListingBoard;
  readonly sectorName: string;
  readonly aliases: readonly string[];
}

/** Bursa sector reference names (real public reference data). */
export const REFERENCE_SECTORS: readonly string[] = [
  'Financial Services',
  'Consumer Products & Services',
  'Technology',
  'Industrial Products & Services',
  'Telecommunications & Media',
];

/**
 * The curated analysed universe for the demo (ordinary shares of Main/ACE only).
 * Kept intentionally small; the generator makes each a full 3-year reconciled
 * timeline. Real Bursa names/codes are public reference data.
 */
export const REFERENCE_UNIVERSE: readonly ReferenceCompany[] = [
  {
    stockCode: '1155',
    shortName: 'MAYBANK',
    fullName: 'Malayan Banking Berhad',
    board: ListingBoard.Main,
    sectorName: 'Financial Services',
    aliases: ['Maybank', 'MBB'],
  },
  {
    stockCode: '1023',
    shortName: 'CIMB',
    fullName: 'CIMB Group Holdings Berhad',
    board: ListingBoard.Main,
    sectorName: 'Financial Services',
    aliases: ['CIMB Group'],
  },
  {
    stockCode: '5347',
    shortName: 'TENAGA',
    fullName: 'Tenaga Nasional Berhad',
    board: ListingBoard.Main,
    sectorName: 'Industrial Products & Services',
    aliases: ['TNB', 'Tenaga Nasional'],
  },
  {
    stockCode: '6888',
    shortName: 'AXIATA',
    fullName: 'Axiata Group Berhad',
    board: ListingBoard.Main,
    sectorName: 'Telecommunications & Media',
    aliases: ['Axiata'],
  },
  {
    stockCode: '0200',
    shortName: 'INARI',
    fullName: 'Inari Amertron Berhad',
    board: ListingBoard.Ace,
    sectorName: 'Technology',
    aliases: ['Inari', 'Inari Amertron'],
  },
];

/** Base seed for the synthetic run; per-instrument seeds derive from stockCode. */
export const SYNTHETIC_BASE_SEED = 0x7576_6a75; // "tuju"

/** Derive a deterministic per-instrument seed from the base seed + stock code. */
export function instrumentSeed(baseSeed: number, stockCode: string): number {
  let h = 0x811c9dc5 ^ (baseSeed >>> 0);
  for (let i = 0; i < stockCode.length; i++) {
    h ^= stockCode.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
