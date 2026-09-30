import { AnnouncementCategory } from '../entities/enums';
import type { PriceBar } from '../entities/price-bar.entity';
import type { Announcement } from '../entities/announcement.entity';
import type { AnnouncementDto, PriceBarDto } from './dto';

/**
 * DTO shape test (ticket 02 Testing seam).
 *
 * Spot-checks that adapter output DTOs carry exactly the *source* fields the
 * corresponding entity requires — the columns the worker must supply — while the
 * DB-managed fields (`id`, `createdAt`, `ingestionRunId`, and the resolved FK) are
 * NOT the adapter's responsibility. The mapping helpers below are compile-time
 * proof that a DTO produces every source column of its entity; the runtime
 * assertions pin the field set so an accidental DTO drift fails a test.
 */

/** The entity columns the worker owns from `PriceBarDto` (excludes id/createdAt/FKs). */
type PriceBarSourceColumns = Omit<
  PriceBar,
  'id' | 'createdAt' | 'instrument' | 'instrumentId' | 'ingestionRun' | 'ingestionRunId'
>;

/** The entity columns the worker owns from `AnnouncementDto` (aiSummary is AI-owned). */
type AnnouncementSourceColumns = Omit<
  Announcement,
  'id' | 'createdAt' | 'company' | 'companyId' | 'ingestionRun' | 'ingestionRunId' | 'aiSummary'
>;

describe('adapter DTO shapes feed their entities', () => {
  it('PriceBarDto carries exactly the PriceBar source fields', () => {
    const dto: PriceBarDto = {
      stockCode: '1155',
      tradeDate: '2024-01-02',
      open: 1.1,
      high: 1.3,
      low: 1.0,
      close: 1.25,
      volume: 123456,
    };

    // Compile-time: the DTO produces every source column of PriceBar (numeric
    // columns are `string` on the entity; the worker stringifies at persist).
    const mapped: PriceBarSourceColumns = {
      tradeDate: dto.tradeDate,
      open: String(dto.open),
      high: String(dto.high),
      low: String(dto.low),
      close: String(dto.close),
      volume: String(dto.volume),
    };

    expect(Object.keys(dto).sort()).toEqual(
      ['close', 'high', 'low', 'open', 'stockCode', 'tradeDate', 'volume'].sort(),
    );
    expect(mapped.close).toBe('1.25');
  });

  it('AnnouncementDto carries exactly the Announcement source fields', () => {
    const filedAt = new Date('2024-03-01T08:00:00.000Z');
    const dto: AnnouncementDto = {
      stockCode: '1155',
      category: AnnouncementCategory.FinancialResults,
      title: 'Quarterly report',
      filedAt,
      sourceUrl: 'https://example.test/ann/1',
    };

    // Compile-time: the DTO produces every worker-owned column of Announcement.
    const mapped: AnnouncementSourceColumns = {
      category: dto.category,
      title: dto.title,
      filedAt: dto.filedAt,
      sourceUrl: dto.sourceUrl,
    };

    expect(Object.keys(dto).sort()).toEqual(
      ['category', 'filedAt', 'sourceUrl', 'stockCode', 'title'].sort(),
    );
    expect(mapped.category).toBe(AnnouncementCategory.FinancialResults);
    expect(mapped.sourceUrl).toBe('https://example.test/ann/1');
  });
});
