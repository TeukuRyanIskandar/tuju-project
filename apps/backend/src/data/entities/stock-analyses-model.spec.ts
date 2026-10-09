import { getMetadataArgsStorage } from 'typeorm';
import { StockAnalysisStatus } from './enums';
import './technical-analysis.entity';
import './fundamental-analysis.entity';

describe('stock analysis domain model', () => {
  const storage = getMetadataArgsStorage();

  const tableTarget = (tableName: string): Function => {
    const table = storage.tables.find(
      (t) => t.name === tableName && typeof t.target === 'function',
    );
    expect(table).toBeDefined();
    return table!.target as Function;
  };

  const columnNamesFor = (target: Function): Set<string> => {
    const names = new Set<string>();
    for (const col of storage.columns) {
      if (col.target === target) {
        names.add(col.options.name ?? col.propertyName);
      }
    }
    return names;
  };

  for (const tableName of ['technical_analyses', 'fundamental_analyses'] as const) {
    it(`${tableName} has unique instrument_id FK shape and status enum`, () => {
      const target = tableTarget(tableName);
      const cols = columnNamesFor(target);

      for (const name of [
        'instrument_id',
        'status',
        'headline',
        'as_of',
        'artifact_bucket',
        'artifact_key',
        'error_message',
        'correlation_id',
        'job_id',
        'created_at',
        'updated_at',
      ]) {
        expect(cols.has(name)).toBe(true);
      }

      const status = storage.columns.find(
        (c) =>
          c.target === target &&
          (c.options.name ?? c.propertyName) === 'status',
      );
      expect(status?.options.type).toBe('enum');
      expect(status?.options.enumName).toBe('stock_analysis_status');
      expect(status?.options.enum).toEqual(StockAnalysisStatus);

      const unique = storage.uniques.find(
        (u) =>
          u.target === target &&
          u.name ===
            (tableName === 'technical_analyses'
              ? 'UQ_technical_analyses_instrument_id'
              : 'UQ_fundamental_analyses_instrument_id'),
      );
      expect(unique?.columns).toEqual(['instrumentId']);

      const relation = storage.relations.find(
        (r) =>
          r.target === target &&
          (r.propertyName === 'instrument' ||
            (r as { options?: { name?: string } }).options?.name ===
              'instrument_id'),
      );
      expect(relation?.options.onDelete).toBe('CASCADE');
    });
  }
});
