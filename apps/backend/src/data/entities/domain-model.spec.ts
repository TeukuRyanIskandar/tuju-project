import { getMetadataArgsStorage } from 'typeorm';
import {
  AnnouncementCategory,
  CorporateActionType,
  IngestionRunKind,
  ListingBoard,
  ProvenanceClass,
  ShariahComplianceStatus,
} from './enums';
// Importing the barrel evaluates every @Entity/@Column decorator, populating the
// global metadata-args storage — no DB connection required (unit lane, ADR-0011).
import './index';

/**
 * Domain-model contract tests (spec 01, build ticket 01).
 *
 * These assert the *shape* every downstream free-tier spec (02–06) relies on,
 * read from TypeORM's decorator metadata — no live Postgres (the unit lane has
 * no Docker). Behavioural guarantees (co-generation reconciliation, the
 * decision-B purge, cadences) are integration concerns of later tickets.
 */
describe('free-tier domain model', () => {
  const storage = getMetadataArgsStorage();

  /** Table name → its target class constructor, for the entities under test. */
  const tableTargets = new Map<string, Function>();
  for (const table of storage.tables) {
    if (typeof table.name === 'string' && typeof table.target === 'function') {
      tableTargets.set(table.name, table.target);
    }
  }

  const columnNamesFor = (target: Function): Set<string> => {
    const names = new Set<string>();
    for (const col of storage.columns) {
      // A column belongs to this (STI) table if it is declared on the table's
      // own class OR on any subclass of it — e.g. SyntheticRun's seed/params
      // columns land in the shared `ingestion_runs` table.
      if (isTargetOrAncestor(target, col.target)) {
        names.add(col.options.name ?? col.propertyName);
      }
    }
    return names;
  };

  /** True when `ancestor` is `descendant` or appears in its prototype chain. */
  function isTargetOrAncestor(ancestor: Function, descendant: unknown): boolean {
    if (typeof descendant !== 'function') return false;
    let proto: Function | null = descendant;
    while (proto) {
      if (proto === ancestor) return true;
      proto = Object.getPrototypeOf(proto);
    }
    return false;
  }

  it('registers every domain table', () => {
    const expected = [
      'ingestion_runs',
      'sectors',
      'companies',
      'instruments',
      'price_bars',
      'quarterly_financials',
      'fundamentals_snapshots',
      'indicator_snapshots',
      'corporate_actions',
      'shariah_statuses',
      'announcements',
      'news_articles',
      'news_article_tags',
      'ipo_listings',
      'watchlists',
      'watchlist_items',
    ];
    for (const name of expected) {
      expect(tableTargets.has(name)).toBe(true);
    }
  });

  describe('provenance is lineage, not a per-row column', () => {
    // Every SOURCED row carries ingestion_run_id → ingestion_runs(id).
    const sourcedTables = [
      'sectors',
      'companies',
      'instruments',
      'price_bars',
      'quarterly_financials',
      'fundamentals_snapshots',
      'indicator_snapshots',
      'corporate_actions',
      'shariah_statuses',
      'announcements',
      'news_articles',
      'ipo_listings',
    ];

    it.each(sourcedTables)(
      '%s exposes an ingestion_run_id FK column',
      (table) => {
        const target = tableTargets.get(table)!;
        expect(columnNamesFor(target).has('ingestion_run_id')).toBe(true);
      },
    );

    it.each(sourcedTables)('%s declares an ingestionRun relation', (table) => {
      const target = tableTargets.get(table)!;
      const hasRelation = storage.relations.some(
        (rel) =>
          isTargetOrAncestor(target, rel.target) &&
          rel.propertyName === 'ingestionRun',
      );
      expect(hasRelation).toBe(true);
    });

    it('does NOT put ingestion_run_id on the account-bound tables', () => {
      // Watchlist / WatchlistItem are not sourced data — no lineage column.
      for (const table of ['watchlists', 'watchlist_items']) {
        const target = tableTargets.get(table)!;
        expect(columnNamesFor(target).has('ingestion_run_id')).toBe(false);
      }
    });

    it('does NOT put ingestion_run_id on the news_article_tags join', () => {
      const target = tableTargets.get('news_article_tags')!;
      expect(columnNamesFor(target).has('ingestion_run_id')).toBe(false);
    });
  });

  describe('IngestionRun single-table inheritance', () => {
    it('uses a `kind` enum discriminator and carries synthetic seed + params', () => {
      const target = tableTargets.get('ingestion_runs')!;
      const cols = columnNamesFor(target);
      // `kind` is the STI discriminator (managed by @TableInheritance), not a
      // plain @Column — assert it via the inheritance metadata.
      const inheritance = storage.inheritances.find((inh) =>
        isTargetOrAncestor(target, inh.target),
      );
      expect(inheritance).toBeDefined();
      expect(inheritance!.column?.name).toBe('kind');
      expect(inheritance!.column?.type).toBe('enum');

      expect(cols.has('provenance_class')).toBe(true);
      // SyntheticRun (STI child) contributes seed + params to the same table.
      expect(cols.has('seed')).toBe(true);
      expect(cols.has('params')).toBe(true);
    });
  });

  describe('Company / Instrument split (ticket 10)', () => {
    it('Instrument FKs Company and has a unique stock_code', () => {
      const target = tableTargets.get('instruments')!;
      const cols = columnNamesFor(target);
      expect(cols.has('company_id')).toBe(true);
      expect(cols.has('stock_code')).toBe(true);

      const stockCodeUnique = storage.uniques.some(
        (u) =>
          isTargetOrAncestor(target, u.target) &&
          Array.isArray(u.columns) &&
          (u.columns as string[]).includes('stockCode'),
      );
      const stockCodeIndexUnique = storage.indices.some(
        (i) =>
          isTargetOrAncestor(target, i.target) &&
          i.unique === true &&
          i.columns != null &&
          (i.columns as string[]).includes('stockCode'),
      );
      expect(stockCodeUnique || stockCodeIndexUnique).toBe(true);
    });

    it('Company FKs Sector and owns fundamentals-side data', () => {
      const company = tableTargets.get('companies')!;
      expect(columnNamesFor(company).has('sector_id')).toBe(true);

      // Quarterly financials / snapshots / shariah / announcements FK company.
      for (const table of [
        'quarterly_financials',
        'fundamentals_snapshots',
        'shariah_statuses',
        'announcements',
        'corporate_actions',
      ]) {
        expect(columnNamesFor(tableTargets.get(table)!).has('company_id')).toBe(
          true,
        );
      }
      // Price bars + indicators attach to Instrument, not Company.
      expect(columnNamesFor(tableTargets.get('price_bars')!).has('instrument_id')).toBe(true);
      expect(
        columnNamesFor(tableTargets.get('indicator_snapshots')!).has('instrument_id'),
      ).toBe(true);
    });
  });

  describe('Watchlist is the only account-bound entity', () => {
    it('carries a user_id and links to instruments via watchlist_items', () => {
      expect(columnNamesFor(tableTargets.get('watchlists')!).has('user_id')).toBe(
        true,
      );
      const itemCols = columnNamesFor(tableTargets.get('watchlist_items')!);
      expect(itemCols.has('watchlist_id')).toBe(true);
      expect(itemCols.has('instrument_id')).toBe(true);
    });

    it('is the only table with a user_id column', () => {
      const tablesWithUserId = [...tableTargets.entries()].filter(([, target]) =>
        columnNamesFor(target).has('user_id'),
      );
      expect(tablesWithUserId.map(([name]) => name)).toEqual(['watchlists']);
    });
  });

  describe('FundamentalsSnapshot materialises the read-once ratios', () => {
    it('has nullable ratio columns (SQL NULL semantics for loss-makers)', () => {
      const cols = columnNamesFor(tableTargets.get('fundamentals_snapshots')!);
      for (const ratio of [
        'pe_ratio',
        'dividend_yield',
        'pnta_ratio',
        'roe',
        'debt_to_equity',
        'psr',
      ]) {
        expect(cols.has(ratio)).toBe(true);
      }
    });
  });

  describe('stable internal enums (adapter-mapped vocabularies)', () => {
    it('AnnouncementCategory has the 10 ticket-10 values', () => {
      expect(Object.values(AnnouncementCategory).sort()).toEqual(
        [
          'ADDITIONAL_LISTING',
          'ANNUAL_REPORT',
          'CIRCULAR',
          'ENTITLEMENT',
          'FINANCIAL_RESULTS',
          'GENERAL',
          'LISTING',
          'MEETING',
          'OTHER',
          'SHAREHOLDING_CHANGE',
        ].sort(),
      );
    });

    it('ProvenanceClass is the licence-boundary axis', () => {
      expect(Object.values(ProvenanceClass).sort()).toEqual(
        ['aggregator', 'real', 'synthetic'].sort(),
      );
    });

    it('IngestionRunKind, CorporateActionType, Shariah, board enums are defined', () => {
      expect(Object.values(IngestionRunKind)).toContain('synthetic');
      expect(Object.values(CorporateActionType)).toContain('DIVIDEND');
      expect(Object.values(ShariahComplianceStatus)).toContain('COMPLIANT');
      expect(Object.values(ListingBoard)).toEqual(
        expect.arrayContaining(['MAIN', 'ACE', 'LEAP']),
      );
    });

    it('enum columns map to native Postgres enum types (not varchar)', () => {
      // Guards the DB-level guarantee: each enum column declares `type: 'enum'`
      // with a stable `enumName` matching the CREATE TYPE in the migration.
      const expected: Record<string, string> = {
        provenance_class: 'provenance_class',
        category: 'announcement_category',
        type: 'corporate_action_type',
        status: 'shariah_compliance_status',
        board: 'listing_board',
      };
      for (const [columnName, enumName] of Object.entries(expected)) {
        const col = storage.columns.find(
          (c) => (c.options.name ?? c.propertyName) === columnName,
        );
        expect(col).toBeDefined();
        expect(col!.options.type).toBe('enum');
        expect(col!.options.enumName).toBe(enumName);
      }
    });
  });
});
