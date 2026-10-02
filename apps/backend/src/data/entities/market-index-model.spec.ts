import { getMetadataArgsStorage } from 'typeorm';
import { MarketIndexKind } from './enums';
// Importing the barrel evaluates every @Entity/@Column decorator, populating the
// global metadata-args storage — no DB connection required (unit lane, ADR-0011).
import './index';
import { IndexLevel } from './index-level.entity';
import { MarketIndex } from './market-index.entity';

/**
 * MarketIndex / IndexLevel contract tests (spec 05, ticket 01).
 *
 * The additive model pair the market-overview surface (tickets 02–05) relies
 * on, asserted the same way the spec-01 domain model is (see
 * `domain-model.spec.ts`): read from TypeORM's decorator metadata — no live
 * Postgres. Behavioural guarantees (migration up/down on real Postgres,
 * natural-key upsert stability, purge-by-lineage) are the integration lane's
 * (`market-index-model.int.spec.ts`).
 */
describe('market index model (spec 05, ticket 01)', () => {
  const storage = getMetadataArgsStorage();

  const columnNamesFor = (target: Function): Set<string> => {
    const names = new Set<string>();
    for (const col of storage.columns) {
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

  it('registers the market_indices and index_levels tables', () => {
    const tableNames = storage.tables
      .map((t) => t.name)
      .filter((n): n is string => typeof n === 'string');
    expect(tableNames).toContain('market_indices');
    expect(tableNames).toContain('index_levels');
  });

  describe('MarketIndex — reference entity (headline + per-Sector)', () => {
    const target = MarketIndex;

    it('discriminates headline vs sector rows with a native enum kind', () => {
      expect(Object.values(MarketIndexKind).sort()).toEqual(
        ['headline', 'sector'].sort(),
      );
      const kind = storage.columns.find(
        (c) => isTargetOrAncestor(target, c.target) && c.propertyName === 'kind',
      );
      expect(kind).toBeDefined();
      expect(kind!.options.type).toBe('enum');
      expect(kind!.options.enumName).toBe('market_index_kind');
    });

    it('FKs its Sector (RESTRICT — real reference data), nullable on headline', () => {
      const cols = columnNamesFor(target);
      expect(cols.has('sector_id')).toBe(true);

      const sectorRelation = storage.relations.find(
        (rel) =>
          isTargetOrAncestor(target, rel.target) &&
          rel.propertyName === 'sector',
      );
      expect(sectorRelation).toBeDefined();
      // The Company→Sector precedent: a Sector is real public reference data
      // that survives the decision-B purge — deleting one must never silently
      // cascade away an index and its chartable level history.
      expect(sectorRelation!.options.onDelete).toBe('RESTRICT');

      const sectorId = storage.columns.find(
        (c) =>
          isTargetOrAncestor(target, c.target) && c.propertyName === 'sectorId',
      );
      expect(sectorId?.options.nullable).toBe(true);
    });

    it('natural-keys (kind, sectorId) so re-ingest upserts in place', () => {
      const unique = storage.uniques.find(
        (u) =>
          isTargetOrAncestor(target, u.target) &&
          Array.isArray(u.columns) &&
          (u.columns as string[]).includes('kind') &&
          (u.columns as string[]).includes('sectorId'),
      );
      expect(unique).toBeDefined();
    });

    it('carries ingestion lineage like every sourced row', () => {
      const cols = columnNamesFor(target);
      expect(cols.has('ingestion_run_id')).toBe(true);
      const hasRelation = storage.relations.some(
        (rel) =>
          isTargetOrAncestor(target, rel.target) &&
          rel.propertyName === 'ingestionRun',
      );
      expect(hasRelation).toBe(true);
    });

    it('does NOT store membership (it is derived, not a join table)', () => {
      // No constituent link relation at all: headline = the whole analysed
      // universe, a sector index = that Sector's instruments. Exact set, so a
      // future constituents/members relation forces a conscious change here.
      const relationNames = storage.relations
        .filter((rel) => isTargetOrAncestor(target, rel.target))
        .map((rel) => rel.propertyName)
        .sort();
      expect(relationNames).toEqual(['ingestionRun', 'sector']);
    });
  });

  describe('IndexLevel — daily series parallel to price bars', () => {
    const target = IndexLevel;

    it('FKs its MarketIndex and carries the daily level value', () => {
      const cols = columnNamesFor(target);
      expect(cols.has('index_id')).toBe(true);
      expect(cols.has('level_date')).toBe(true);
      const level = storage.columns.find(
        (c) =>
          isTargetOrAncestor(target, c.target) && c.propertyName === 'level',
      );
      expect(level).toBeDefined();
      expect(level!.options.type).toBe('numeric');

      const indexRelation = storage.relations.find(
        (rel) =>
          isTargetOrAncestor(target, rel.target) &&
          rel.propertyName === 'marketIndex',
      );
      expect(indexRelation).toBeDefined();
    });

    it('natural-keys (indexId, levelDate) for re-ingest idempotency', () => {
      const unique = storage.uniques.find(
        (u) =>
          isTargetOrAncestor(target, u.target) &&
          Array.isArray(u.columns) &&
          (u.columns as string[]).includes('indexId') &&
          (u.columns as string[]).includes('levelDate'),
      );
      expect(unique).toBeDefined();
    });

    it('carries ingestion lineage like every sourced row', () => {
      const cols = columnNamesFor(target);
      expect(cols.has('ingestion_run_id')).toBe(true);
      const hasRelation = storage.relations.some(
        (rel) =>
          isTargetOrAncestor(target, rel.target) &&
          rel.propertyName === 'ingestionRun',
      );
      expect(hasRelation).toBe(true);
    });
  });
});
