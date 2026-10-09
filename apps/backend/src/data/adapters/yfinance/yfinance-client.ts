import YahooFinance from 'yahoo-finance2';

export interface YahooHistoricalBar {
  readonly date: Date;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface YahooDividendRow {
  readonly date: Date;
  readonly dividends: number;
}

export interface YahooQuoteSummary {
  readonly defaultKeyStatistics?: {
    readonly sharesOutstanding?: number;
  };
}

export interface YahooFinancialsRow {
  readonly date: Date;
  readonly TYPE?: string;
  readonly totalRevenue?: number;
  readonly netIncome?: number;
  readonly dilutedEPS?: number;
  readonly basicEPS?: number;
  readonly stockholdersEquity?: number;
  readonly commonStockEquity?: number;
  readonly tangibleBookValue?: number;
  readonly netTangibleAssets?: number;
  readonly goodwillAndOtherIntangibleAssets?: number;
  readonly otherIntangibleAssets?: number;
  readonly goodwill?: number;
  readonly totalDebt?: number;
  readonly ordinarySharesNumber?: number;
}

export interface YahooFinanceClient {
  historical(
    symbol: string,
    options: {
      period1: Date | string | number;
      period2?: Date | string | number;
      interval?: '1d' | '1wk' | '1mo';
      events?: 'history' | 'dividends' | 'split';
    },
  ): Promise<YahooHistoricalBar[] | YahooDividendRow[]>;
  quoteSummary(
    symbol: string,
    options: { modules: readonly string[] },
  ): Promise<YahooQuoteSummary>;
  fundamentalsTimeSeries(
    symbol: string,
    options: {
      period1: Date | string | number;
      period2?: Date | string | number;
      type?: string;
      module: string;
    },
  ): Promise<YahooFinancialsRow[]>;
}

export function createYahooFinanceClient(): YahooFinanceClient {
  const yahooFinance = new YahooFinance({
    suppressNotices: ['yahooSurvey'],
  });
  return yahooFinance as unknown as YahooFinanceClient;
}
