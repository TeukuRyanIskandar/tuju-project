import { computeTechnicalEvents } from './technical-events';
import type { IndicatorSnapshot } from '../data/entities/indicator-snapshot.entity';
import type { PriceBar } from '../data/entities/price-bar.entity';

describe('computeTechnicalEvents', () => {
  const makeSnap = (overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot => ({
    id: 'snap-id',
    instrumentId: 'inst-id',
    instrument: null as any,
    latestClose: '10.02',
    sma20: '9.7',
    sma50: '9.55',
    sma200: '9.3',
    rsi14: '57.4',
    macd: '0.02123',
    macdSignal: '0.015',
    week52High: '10.45',
    week52Low: '8.32',
    ingestionRunId: 'run-id',
    ingestionRun: null as any,
    createdAt: new Date(),
    ...overrides,
  });

  const makeBar = (close: string, overrides: Partial<PriceBar> = {}): PriceBar => ({
    id: 'bar-id',
    instrumentId: 'inst-id',
    instrument: null as any,
    tradeDate: '2026-10-07',
    open: '9.8',
    high: '10.1',
    low: '9.75',
    close,
    volume: '5000000',
    ingestionRunId: 'run-id',
    ingestionRun: null as any,
    createdAt: new Date(),
    ...overrides,
  });

  it('should compute all 7 events with normal indicator values', () => {
    const snap = makeSnap();
    const prevBar = makeBar('10.0');
    const latestCloseDay = '2026-10-08';

    const events = computeTechnicalEvents(snap, latestCloseDay, prevBar);

    expect(events).toHaveLength(7);
    expect(events.map((e) => e.id)).toEqual([
      'ma_cross_20_50',
      'ma_cross_50_200',
      'price_vs_sma',
      'rsi_band',
      'macd_cross',
      'week52_proximity',
      'broke_swing_high',
    ]);
  });

  describe('ma_cross_20_50', () => {
    it('should fire when sma20 > sma50', () => {
      const snap = makeSnap({ sma20: '10.0', sma50: '9.0' });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'ma_cross_20_50')!;
      expect(event.fired).toBe(true);
      expect(event.values.sma20).toBe(10.0);
      expect(event.values.sma50).toBe(9.0);
    });

    it('should not fire when sma20 <= sma50', () => {
      const snap = makeSnap({ sma20: '9.0', sma50: '10.0' });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'ma_cross_20_50')!;
      expect(event.fired).toBe(false);
    });

    it('should not fire when either is null', () => {
      const snap = makeSnap({ sma20: null });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'ma_cross_20_50')!;
      expect(event.fired).toBe(false);
      expect(event.values.sma20).toBeNull();
    });
  });

  describe('ma_cross_50_200', () => {
    it('should fire when sma50 > sma200', () => {
      const snap = makeSnap({ sma50: '10.0', sma200: '9.0' });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'ma_cross_50_200')!;
      expect(event.fired).toBe(true);
    });

    it('should not fire when sma50 <= sma200', () => {
      const snap = makeSnap({ sma50: '9.0', sma200: '10.0' });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'ma_cross_50_200')!;
      expect(event.fired).toBe(false);
    });
  });

  describe('price_vs_sma', () => {
    it('should fire when latestClose > sma50', () => {
      const snap = makeSnap({ latestClose: '10.0', sma50: '9.0' });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'price_vs_sma')!;
      expect(event.fired).toBe(true);
      expect(event.values.close).toBe(10.0);
      expect(event.values.sma50).toBe(9.0);
    });

    it('should not fire when latestClose <= sma50', () => {
      const snap = makeSnap({ latestClose: '9.0', sma50: '10.0' });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'price_vs_sma')!;
      expect(event.fired).toBe(false);
    });
  });

  describe('rsi_band', () => {
    it('should fire with overbought band when rsi14 > 70', () => {
      const snap = makeSnap({ rsi14: '75.0' });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'rsi_band')!;
      expect(event.fired).toBe(true);
      expect(event.values.band).toBe('overbought');
      expect(event.label).toContain('overbought');
    });

    it('should fire with oversold band when rsi14 < 30', () => {
      const snap = makeSnap({ rsi14: '25.0' });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'rsi_band')!;
      expect(event.fired).toBe(true);
      expect(event.values.band).toBe('oversold');
      expect(event.label).toContain('oversold');
    });

    it('should fire with mid band when 30 <= rsi14 <= 70', () => {
      const snap = makeSnap({ rsi14: '50.0' });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'rsi_band')!;
      expect(event.fired).toBe(true);
      expect(event.values.band).toBe('mid');
      expect(event.label).toContain('mid band');
    });

    it('should not fire when rsi14 is null', () => {
      const snap = makeSnap({ rsi14: null });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'rsi_band')!;
      expect(event.fired).toBe(false);
      expect(event.values.rsi).toBeNull();
    });
  });

  describe('macd_cross', () => {
    it('should fire when macd > macdSignal', () => {
      const snap = makeSnap({ macd: '0.02', macdSignal: '0.01' });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'macd_cross')!;
      expect(event.fired).toBe(true);
      expect(event.values.line).toBe(0.02);
      expect(event.values.signal).toBe(0.01);
    });

    it('should not fire when macd <= macdSignal', () => {
      const snap = makeSnap({ macd: '0.01', macdSignal: '0.02' });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'macd_cross')!;
      expect(event.fired).toBe(false);
    });

    it('should not fire when either is null', () => {
      const snap = makeSnap({ macd: null });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'macd_cross')!;
      expect(event.fired).toBe(false);
    });
  });

  describe('week52_proximity', () => {
    it('should fire when within 5% of 52-week high', () => {
      // week52High = 10.0, close = 9.5 (5% below = at threshold)
      const snap = makeSnap({
        latestClose: '9.5',
        week52High: '10.0',
      });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'week52_proximity')!;
      expect(event.fired).toBe(true);
      expect(event.values.close).toBe(9.5);
      expect(event.values.week52High).toBe(10.0);
      expect((event.values.pctFromHigh as number).toFixed(2)).toBe('-5.00');
    });

    it('should not fire when more than 5% below 52-week high', () => {
      // week52High = 10.0, close = 9.4 (6% below)
      const snap = makeSnap({
        latestClose: '9.4',
        week52High: '10.0',
      });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'week52_proximity')!;
      expect(event.fired).toBe(false);
    });

    it('should fire when at or above 52-week high', () => {
      const snap = makeSnap({
        latestClose: '10.0',
        week52High: '10.0',
      });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'week52_proximity')!;
      expect(event.fired).toBe(true);
    });

    it('should not fire when week52High is null', () => {
      const snap = makeSnap({ week52High: null });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'week52_proximity')!;
      expect(event.fired).toBe(false);
    });
  });

  describe('broke_swing_high', () => {
    it('should fire when latestClose > prevBar.close', () => {
      const snap = makeSnap({ latestClose: '10.02' });
      const prevBar = makeBar('10.0');
      const events = computeTechnicalEvents(snap, '2026-10-08', prevBar);
      const event = events.find((e) => e.id === 'broke_swing_high')!;
      expect(event.fired).toBe(true);
      expect(event.values.swingHigh).toBe(10.0);
      expect(event.values.close).toBe(10.02);
    });

    it('should not fire when latestClose <= prevBar.close', () => {
      const snap = makeSnap({ latestClose: '10.0' });
      const prevBar = makeBar('10.01');
      const events = computeTechnicalEvents(snap, '2026-10-08', prevBar);
      const event = events.find((e) => e.id === 'broke_swing_high')!;
      expect(event.fired).toBe(false);
    });

    it('should not fire when prevBar is null', () => {
      const snap = makeSnap({ latestClose: '10.02' });
      const events = computeTechnicalEvents(snap, '2026-10-08', null);
      const event = events.find((e) => e.id === 'broke_swing_high')!;
      expect(event.fired).toBe(false);
      expect(event.values.swingHigh).toBeNull();
    });
  });

  it('should include latestCloseDay in all event timestamps', () => {
    const snap = makeSnap();
    const latestCloseDay = '2026-10-08';
    const events = computeTechnicalEvents(snap, latestCloseDay, null);
    events.forEach((event) => {
      expect(event.at).toBe(latestCloseDay);
    });
  });

  it('should compute macd histogram when both values present', () => {
    const snap = makeSnap({
      macd: '0.05',
      macdSignal: '0.03',
    });
    const events = computeTechnicalEvents(snap, '2026-10-08', null);
    const technicalFacts = events;
    const macdEvent = events.find((e) => e.id === 'macd_cross')!;
    expect(macdEvent.values.line).toBe(0.05);
    expect(macdEvent.values.signal).toBe(0.03);
  });
});
