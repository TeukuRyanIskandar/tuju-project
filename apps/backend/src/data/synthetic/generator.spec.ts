import { CorporateActionType } from '../entities/enums';
import {
  Decimal,
  add,
  divide,
  fromString,
  fromUnits,
  mul,
  sub,
  toStringAtScale,
} from './decimal';
import { generate } from './generator';
import {
  DEFAULT_PARAMS,
  SCALE,
  SyntheticDataset,
  SyntheticParams,
} from './types';

/**
 * Synthetic co-generation reconciliation tests (spec 01, decision A1, ticket 03).
 *
 * The point of these tests is that they NEVER call the generator's own ratio
 * module. They recompute every ratio from first principles off the emitted DTOs
 * (price bars, quarterly financials, dividend actions, shares outstanding) and
 * assert the generator's materialised {@link FundamentalsSnapshotDto} agrees. So
 * "reconciles" means: an independent reader of the emitted rows derives the same
 * numbers the generator wrote — the A1 guarantee.
 */

const SEED = 0x5eed_1234;

// ---------- independent ratio recomputation (does NOT import ./ratios) ----------

function lastN<T>(arr: T[], n: number): T[] {
  return arr.slice(arr.length - n);
}

function recomputeTtmEps(ds: SyntheticDataset): Decimal {
  const q = lastN(ds.quarterlyFinancials, 4);
  return q.reduce(
    (acc, r) => add(acc, fromString(r.eps, SCALE.eps)),
    fromUnits(0n, SCALE.eps),
  );
}

function recomputeTtmRevenue(ds: SyntheticDataset): Decimal {
  const q = lastN(ds.quarterlyFinancials, 4);
  return q.reduce(
    (acc, r) => add(acc, fromString(r.revenue, SCALE.money)),
    fromUnits(0n, SCALE.money),
  );
}

function recomputeTtmNetProfit(ds: SyntheticDataset): Decimal {
  const q = lastN(ds.quarterlyFinancials, 4);
  return q.reduce(
    (acc, r) => add(acc, fromString(r.netProfit, SCALE.money)),
    fromUnits(0n, SCALE.money),
  );
}

function latestClose(ds: SyntheticDataset): Decimal {
  const bars = ds.priceBars;
  return fromString(bars[bars.length - 1].close, SCALE.price);
}

// ---------- reconciliation ----------

describe('synthetic co-generation — reconciliation (A1)', () => {
  const ds = generate(SEED, DEFAULT_PARAMS);
  const shares = BigInt(ds.snapshot.sharesOutstanding);

  it('P/E reconciles: price ÷ TTM EPS', () => {
    const eps = recomputeTtmEps(ds);
    expect(eps.units > 0n).toBe(true); // default params are profitable
    const expected = toStringAtScale(
      divide(latestClose(ds), eps, SCALE.ratio),
      SCALE.ratio,
    );
    expect(ds.snapshot.peRatio).toBe(expected);
  });

  it('TTM EPS / revenue / net profit reconcile against emitted quarters', () => {
    expect(ds.snapshot.ttmEps).toBe(
      toStringAtScale(recomputeTtmEps(ds), SCALE.eps),
    );
    expect(ds.snapshot.ttmRevenue).toBe(
      toStringAtScale(recomputeTtmRevenue(ds), SCALE.money),
    );
    expect(ds.snapshot.ttmNetProfit).toBe(
      toStringAtScale(recomputeTtmNetProfit(ds), SCALE.money),
    );
  });

  it('P/NTA reconciles: price ÷ ((equity − intangibles) ÷ shares)', () => {
    const q = ds.quarterlyFinancials[ds.quarterlyFinancials.length - 1];
    const tangible = sub(
      fromString(q.equity, SCALE.money),
      fromString(q.intangibles, SCALE.money),
    );
    const ntaPerShare = divide(tangible, fromUnits(shares, 0), SCALE.ratio);
    expect(ds.snapshot.ntaPerShare).toBe(
      toStringAtScale(ntaPerShare, SCALE.ratio),
    );
    const expected = toStringAtScale(
      divide(latestClose(ds), ntaPerShare, SCALE.ratio),
      SCALE.ratio,
    );
    expect(ds.snapshot.pntaRatio).toBe(expected);
  });

  it('P/NTA ≠ P/B (a nonzero intangibles line is emitted)', () => {
    const q = ds.quarterlyFinancials[ds.quarterlyFinancials.length - 1];
    // Book value per share uses full equity (P/B); NTA/share strips intangibles.
    const bookPerShare = divide(
      fromString(q.equity, SCALE.money),
      fromUnits(shares, 0),
      SCALE.ratio,
    );
    const pb = divide(latestClose(ds), bookPerShare, SCALE.ratio);
    expect(fromString(q.intangibles, SCALE.money).units > 0n).toBe(true);
    expect(ds.snapshot.pntaRatio).not.toBe(toStringAtScale(pb, SCALE.ratio));
  });

  it('ROE reconciles: TTM net profit ÷ AVERAGE equity (opening+closing)/2', () => {
    const qs = ds.quarterlyFinancials;
    const closing = fromString(qs[qs.length - 1].equity, SCALE.money);
    const opening = fromString(qs[qs.length - 4].equity, SCALE.money);
    const avg = divide(add(opening, closing), fromUnits(2n, 0), SCALE.money);
    const expected = toStringAtScale(
      divide(recomputeTtmNetProfit(ds), avg, SCALE.ratio),
      SCALE.ratio,
    );
    expect(ds.snapshot.roe).toBe(expected);
  });

  it('D/E reconciles: latest total borrowings ÷ latest equity', () => {
    const q = ds.quarterlyFinancials[ds.quarterlyFinancials.length - 1];
    const expected = toStringAtScale(
      divide(
        fromString(q.totalBorrowings, SCALE.money),
        fromString(q.equity, SCALE.money),
        SCALE.ratio,
      ),
      SCALE.ratio,
    );
    expect(ds.snapshot.debtToEquity).toBe(expected);
  });

  it('PSR reconciles: (price × shares) ÷ TTM revenue', () => {
    const marketCap = mul(latestClose(ds), fromUnits(shares, 0));
    const expected = toStringAtScale(
      divide(marketCap, recomputeTtmRevenue(ds), SCALE.ratio),
      SCALE.ratio,
    );
    expect(ds.snapshot.psr).toBe(expected);
  });

  it('DY reconciles: trailing-12-month dividend per share ÷ price', () => {
    const asOf = ds.priceBars[ds.priceBars.length - 1].tradeDate;
    const [ey, em, edd] = asOf.split('-').map((s) => parseInt(s, 10));
    const windowStart = `${(ey - 1).toString().padStart(4, '0')}-${em
      .toString()
      .padStart(2, '0')}-${edd.toString().padStart(2, '0')}`;
    let dps = fromUnits(0n, SCALE.dividend);
    for (const d of ds.dividends) {
      if (
        d.type === CorporateActionType.Dividend &&
        d.amount !== null &&
        d.exDate > windowStart &&
        d.exDate <= asOf
      ) {
        dps = add(dps, fromString(d.amount, SCALE.dividend));
      }
    }
    expect(dps.units > 0n).toBe(true); // at least one dividend in the window
    const expected = toStringAtScale(
      divide(dps, latestClose(ds), SCALE.ratio),
      SCALE.ratio,
    );
    expect(ds.snapshot.dividendYield).toBe(expected);
  });

  it('consecutive YoY net-profit growth reconciles (same quarter one year prior)', () => {
    const qs = ds.quarterlyFinancials;
    let count = 0;
    for (let i = qs.length - 1; i - 4 >= 0; i--) {
      const cur = fromString(qs[i].netProfit, SCALE.money);
      const prior = fromString(qs[i - 4].netProfit, SCALE.money);
      if (cur.units > prior.units) count++;
      else break;
    }
    expect(ds.snapshot.consecutiveGrowthQuarters).toBe(count);
  });
});

// ---------- edge cases (table-driven) ----------

describe('synthetic co-generation — ratio edge cases', () => {
  it('loss-maker: P/E is null when TTM EPS ≤ 0', () => {
    const params: SyntheticParams = { ...DEFAULT_PARAMS, forceLatestLoss: true };
    const ds = generate(SEED, params);
    const eps = recomputeTtmEps(ds);
    expect(eps.units <= 0n).toBe(true);
    expect(ds.snapshot.peRatio).toBeNull();
    // ttmEps is still reported (may be negative), just P/E is null.
    expect(ds.snapshot.ttmEps).toBe(toStringAtScale(eps, SCALE.eps));
  });

  it('profitable default: P/E is non-null', () => {
    const ds = generate(SEED, DEFAULT_PARAMS);
    expect(ds.snapshot.peRatio).not.toBeNull();
  });
});

// ---------- determinism ----------

describe('synthetic co-generation — determinism', () => {
  it('same seed + params → byte-identical output across two runs', () => {
    const a = generate(SEED, DEFAULT_PARAMS);
    const b = generate(SEED, DEFAULT_PARAMS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seed → different price series (with identical params)', () => {
    const a = generate(SEED, DEFAULT_PARAMS);
    const b = generate(SEED + 1, DEFAULT_PARAMS);
    expect(JSON.stringify(a.priceBars)).not.toBe(JSON.stringify(b.priceBars));
  });

  it('shares outstanding is stable across seeds (held constant, A1)', () => {
    const a = generate(SEED, DEFAULT_PARAMS);
    const b = generate(SEED + 7, DEFAULT_PARAMS);
    expect(a.snapshot.sharesOutstanding).toBe(b.snapshot.sharesOutstanding);
    expect(a.snapshot.sharesOutstanding).toBe(
      DEFAULT_PARAMS.sharesOutstanding.toString(),
    );
  });
});

// ---------- backfill shape ----------

describe('synthetic co-generation — backfill shape', () => {
  const ds = generate(SEED, DEFAULT_PARAMS);

  it('emits ~750 trading days of price bars (warms SMA-200)', () => {
    expect(ds.priceBars.length).toBe(DEFAULT_PARAMS.tradingDays);
    expect(ds.priceBars.length).toBeGreaterThanOrEqual(750);
  });

  it('price bars are weekdays only, strictly ascending, unique dates', () => {
    const dates = ds.priceBars.map((b) => b.tradeDate);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] > dates[i - 1]).toBe(true);
    }
    // No Saturdays/Sundays (Sakamoto): recompute dow and assert weekday.
    for (const iso of dates) {
      const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
      const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
      let yy = y;
      if (m < 3) yy -= 1;
      const dow =
        (yy +
          Math.floor(yy / 4) -
          Math.floor(yy / 100) +
          Math.floor(yy / 400) +
          t[m - 1] +
          d) %
        7;
      expect(dow).not.toBe(0);
      expect(dow).not.toBe(6);
    }
  });

  it('emits 12 quarters of financials, ascending unique fiscal periods', () => {
    expect(ds.quarterlyFinancials.length).toBe(DEFAULT_PARAMS.quarters);
    const keys = ds.quarterlyFinancials.map(
      (q) => q.fiscalYear * 4 + q.fiscalQuarter,
    );
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i]).toBeGreaterThan(keys[i - 1]);
    }
    for (const q of ds.quarterlyFinancials) {
      expect(q.fiscalQuarter).toBeGreaterThanOrEqual(1);
      expect(q.fiscalQuarter).toBeLessThanOrEqual(4);
    }
  });

  it('price/money/eps figures are fixed-scale numeric strings', () => {
    const bar = ds.priceBars[0];
    for (const v of [bar.open, bar.high, bar.low, bar.close]) {
      expect(v).toMatch(/^-?\d+\.\d{6}$/);
    }
    expect(bar.volume).toMatch(/^\d+$/);
    const q = ds.quarterlyFinancials[0];
    for (const v of [
      q.revenue,
      q.netProfit,
      q.equity,
      q.nta,
      q.intangibles,
      q.totalBorrowings,
    ]) {
      expect(v).toMatch(/^-?\d+\.\d{2}$/);
    }
    expect(q.eps).toMatch(/^-?\d+\.\d{6}$/);
  });

  it('high ≥ max(open,close) and low ≤ min(open,close) per bar', () => {
    for (const b of ds.priceBars) {
      const open = fromString(b.open, SCALE.price);
      const close = fromString(b.close, SCALE.price);
      const high = fromString(b.high, SCALE.price);
      const low = fromString(b.low, SCALE.price);
      const maxOC = open.units > close.units ? open : close;
      const minOC = open.units < close.units ? open : close;
      expect(high.units >= maxOC.units).toBe(true);
      expect(low.units <= minOC.units).toBe(true);
    }
  });
});
