/**
 * Postgres/pg_trgm implementation of the {@link InstrumentSearch} seam
 * (spec 02 "Search matching"; ticket 02).
 *
 * Rank bands, tried in precedence order — the FIRST band with hits wins and
 * its rows (ordered by that band's within-band rule, capped at `limit`) are
 * the whole result; a lower-band hit never dilutes a higher band's hits:
 *
 *   1. exact `stockCode` (unique natural key — a single row, always rank 1)
 *   2. `stockCode` prefix (`LIKE 'q%'`; shorter codes first — closest to
 *      exact — then lexicographic, for determinism)
 *   3. name prefix (`ILIKE 'q%'`, case-insensitive; a shortName hit outranks
 *      a fullName hit, then trigram similarity desc, then name asc)
 *   4. pg_trgm `similarity()` desc over the name columns — GREATEST of
 *      short/full similarity, short-name similarity breaking ties
 *      (short over full), with the pg_trgm default threshold 0.3 as the
 *      entry filter
 *
 * Universe: the analysed universe — ordinary shares of MAIN/ACE companies.
 * The board filter rides every band query, so LEAP rows are never searchable.
 *
 * The spec-01 GIN trigram indexes accelerate bands 2–3's LIKE/ILIKE prefix
 * matches; band 4's lower()-wrapped similarity() (pg_trgm similarity is
 * case-sensitive; ILIKE is not) cannot use them, but pg_trgm stays correct
 * at full-Bursa scale (the spec's row-count-never-bites decision) and the
 * class-2 read cache absorbs repeat volume.
 */

import { Injectable } from '@nestjs/common';
import { DataSource, type SelectQueryBuilder } from 'typeorm';
import { Company } from '../data/entities/company.entity';
import { Instrument } from '../data/entities/instrument.entity';
import { ListingBoard } from '../data/entities/enums';
import type {
  InstrumentSearch,
  SearchResultRow,
} from './instrument-search.interface';

/** Only ordinary shares of MAIN/ACE companies are searchable (spec 02). */
const SEARCHABLE_BOARDS: readonly ListingBoard[] = [
  ListingBoard.Main,
  ListingBoard.Ace,
];

/** pg_trgm's default similarity threshold — the fuzzy band's entry filter. */
const FUZZY_SIMILARITY_THRESHOLD = 0.3;

/** Raw select-alias shape returned by the band queries. */
interface RawSearchRow {
  stock_code: string;
  short_name: string;
  full_name: string;
  company_name: string;
  board: string;
  sector_name: string;
}

@Injectable()
export class PgInstrumentSearch implements InstrumentSearch {
  constructor(private readonly dataSource: DataSource) {}

  async search(query: string, limit: number): Promise<SearchResultRow[]> {
    // The service normalises and never calls with an empty query, but a bare
    // LIKE '%' below would match the WHOLE universe — guard the seam anyway.
    if (query === '') return [];

    const exact = await this.exactCode(query, limit);
    if (exact.length > 0) return exact;

    const codePrefix = await this.codePrefix(query, limit);
    if (codePrefix.length > 0) return codePrefix;

    const namePrefix = await this.namePrefix(query, limit);
    if (namePrefix.length > 0) return namePrefix;

    return this.fuzzyName(query, limit);
  }

  /**
   * Shared universe query: instrument identity joined to issuer identity,
   * filtered to the analysed universe (MAIN/ACE boards only).
   */
  private baseQuery(): SelectQueryBuilder<Instrument> {
    return this.dataSource
      .getRepository(Instrument)
      .createQueryBuilder('i')
      .innerJoin('i.company', 'c')
      .innerJoin('c.sector', 's')
      .where('c.board IN (:...boards)', { boards: SEARCHABLE_BOARDS })
      .select('i.stock_code', 'stock_code')
      .addSelect('i.short_name', 'short_name')
      .addSelect('i.full_name', 'full_name')
      .addSelect('c.full_name', 'company_name')
      .addSelect('c.board', 'board')
      .addSelect('s.name', 'sector_name');
  }

  /** Band 1: exact stockCode — the unique natural key, so exactly one row. */
  private async exactCode(query: string, limit: number): Promise<SearchResultRow[]> {
    const rows = await this.baseQuery()
      .andWhere('i.stock_code = :q', { q: query })
      .orderBy('i.stock_code', 'ASC')
      .limit(limit)
      .getRawMany<RawSearchRow>();
    return rows.map(toRow);
  }

  /** Band 2: stockCode prefix; shorter codes first (closest to exact). */
  private async codePrefix(query: string, limit: number): Promise<SearchResultRow[]> {
    const rows = await this.baseQuery()
      .andWhere('i.stock_code LIKE :prefix', { prefix: `${escapeLikePattern(query)}%` })
      .orderBy('LENGTH(i.stock_code)', 'ASC')
      .addOrderBy('i.stock_code', 'ASC')
      .limit(limit)
      .getRawMany<RawSearchRow>();
    return rows.map(toRow);
  }

  /**
   * Band 3: name prefix (case-insensitive). Within the band: a shortName hit
   * outranks a fullName hit (`name_kind`), then similarity desc, then name
   * asc — all deterministic.
   */
  private async namePrefix(query: string, limit: number): Promise<SearchResultRow[]> {
    const rows = await this.baseQuery()
      .setParameters({ prefix: `${escapeLikePattern(query)}%`, lq: query.toLowerCase() })
      .addSelect(
        'CASE WHEN i.short_name ILIKE :prefix THEN 0 ELSE 1 END',
        'name_kind',
      )
      .addSelect(
        'GREATEST(similarity(lower(i.short_name), :lq), similarity(lower(i.full_name), :lq))',
        'name_sim',
      )
      .andWhere('(i.short_name ILIKE :prefix OR i.full_name ILIKE :prefix)')
      .orderBy('name_kind', 'ASC')
      .addOrderBy('name_sim', 'DESC')
      .addOrderBy('i.short_name', 'ASC')
      .limit(limit)
      .getRawMany<RawSearchRow>();
    return rows.map(toRow);
  }

  /**
   * Band 4: pg_trgm similarity desc over the name columns (short-name
   * similarity breaks ties — a short-name match outranks an equal full-name
   * match). lower() on both sides because pg_trgm similarity is
   * case-sensitive while the rest of the ranking is not.
   */
  private async fuzzyName(query: string, limit: number): Promise<SearchResultRow[]> {
    const rows = await this.baseQuery()
      .setParameters({
        lq: query.toLowerCase(),
        threshold: FUZZY_SIMILARITY_THRESHOLD,
      })
      .addSelect(
        'GREATEST(similarity(lower(i.short_name), :lq), similarity(lower(i.full_name), :lq))',
        'best_sim',
      )
      .addSelect('similarity(lower(i.short_name), :lq)', 'short_sim')
      .andWhere(
        '(similarity(lower(i.short_name), :lq) >= :threshold OR ' +
          'similarity(lower(i.full_name), :lq) >= :threshold)',
      )
      .orderBy('best_sim', 'DESC')
      .addOrderBy('short_sim', 'DESC')
      .addOrderBy('i.short_name', 'ASC')
      .limit(limit)
      .getRawMany<RawSearchRow>();
    return rows.map(toRow);
  }
}

/** Map a raw select-alias row onto the endpoint's SearchResultRow shape. */
function toRow(raw: RawSearchRow): SearchResultRow {
  return {
    stockCode: raw.stock_code,
    shortName: raw.short_name,
    fullName: raw.full_name,
    companyName: raw.company_name,
    board: raw.board,
    sectorName: raw.sector_name,
  };
}

/**
 * Escape LIKE/ILIKE metacharacters so a query containing `%` or `_` matches
 * literally instead of acting as a wildcard (Postgres' default escape char
 * is the backslash). Stock codes and names rarely contain either, but a
 * query like `1_5` must not wildcard-match `1155`.
 */
function escapeLikePattern(input: string): string {
  return input.replace(/([%_\\])/g, '\\$1');
}
