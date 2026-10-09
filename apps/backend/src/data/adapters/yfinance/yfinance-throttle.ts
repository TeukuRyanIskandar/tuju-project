export const YFINANCE_MIN_INTERVAL_MS = 200;
export const YFINANCE_MAX_RETRIES = 3;
export const YFINANCE_BACKOFF_BASE_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const status =
    'response' in error &&
    error.response !== null &&
    typeof error.response === 'object' &&
    'status' in error.response
      ? Number((error.response as { status: unknown }).status)
      : 'statusCode' in error
        ? Number((error as { statusCode: unknown }).statusCode)
        : NaN;
  if (status === 429 || (status >= 500 && status < 600)) {
    return true;
  }
  const message =
    'message' in error && typeof error.message === 'string'
      ? error.message
      : '';
  return /\b429\b|\b5\d\d\b|Too Many Requests|rate limit/i.test(message);
}

export class YFinanceThrottle {
  private chain: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;

  constructor(
    private readonly minIntervalMs = YFINANCE_MIN_INTERVAL_MS,
    private readonly maxRetries = YFINANCE_MAX_RETRIES,
    private readonly backoffBaseMs = YFINANCE_BACKOFF_BASE_MS,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const runAttempt = async (): Promise<T> => {
      let lastError: unknown;
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        await this.waitTurn();
        try {
          return await fn();
        } catch (error) {
          lastError = error;
          if (attempt >= this.maxRetries || !isRetryableStatus(error)) {
            throw error;
          }
          await sleep(this.backoffBaseMs * 2 ** attempt);
        }
      }
      throw lastError;
    };

    const result = this.chain.then(runAttempt, runAttempt);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async waitTurn(): Promise<void> {
    const now = Date.now();
    const waitMs = Math.max(0, this.nextAllowedAt - now);
    this.nextAllowedAt = Math.max(now, this.nextAllowedAt) + this.minIntervalMs;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }
}
