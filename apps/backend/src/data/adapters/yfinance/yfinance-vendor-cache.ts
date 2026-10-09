import type { Redis } from 'ioredis';

export const YFINANCE_VENDOR_PREFIX = 'vendor:yfinance:';

export const YFINANCE_BARS_TTL_SECONDS = 6 * 60 * 60;
export const YFINANCE_FUNDAMENTALS_TTL_SECONDS = 24 * 60 * 60;
export const YFINANCE_DIVIDENDS_TTL_SECONDS = 24 * 60 * 60;

export class YFinanceVendorCache {
  private readonly memory = new Map<string, { expiresAt: number; value: string }>();

  constructor(private readonly redis: Redis | null) {}

  barsKey(yahooSymbol: string, period1: string): string {
    return `${YFINANCE_VENDOR_PREFIX}bars:${yahooSymbol}:${period1}`;
  }

  fundamentalsKey(yahooSymbol: string): string {
    return `${YFINANCE_VENDOR_PREFIX}fundamentals:${yahooSymbol}`;
  }

  dividendsKey(yahooSymbol: string): string {
    return `${YFINANCE_VENDOR_PREFIX}dividends:${yahooSymbol}`;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.getRaw(key);
    if (raw === null) {
      return null;
    }
    return JSON.parse(raw) as T;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.setRaw(key, JSON.stringify(value), ttlSeconds);
  }

  private async getRaw(key: string): Promise<string | null> {
    if (this.redis) {
      return this.redis.get(key);
    }
    const entry = this.memory.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() >= entry.expiresAt) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }

  private async setRaw(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    if (this.redis) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
      return;
    }
    this.memory.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
}
