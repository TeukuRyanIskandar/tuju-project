import {
  getKlci30Row,
  isKlci30,
  KLCI30_UNIVERSE,
} from './klci30-universe';

describe('KLCI30_UNIVERSE', () => {
  it('has exactly 30 members', () => {
    expect(KLCI30_UNIVERSE).toHaveLength(30);
  });

  it('has unique stockCodes', () => {
    const codes = KLCI30_UNIVERSE.map((row) => row.stockCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses uniform Yahoo .KL symbols', () => {
    for (const row of KLCI30_UNIVERSE) {
      expect(row.yahooSymbol).toBe(`${row.stockCode}.KL`);
      expect(row.yahooSymbol.endsWith('.KL')).toBe(true);
    }
  });

  it('includes demo exemplar 1155 / MAYBANK', () => {
    const maybank = getKlci30Row('1155');
    expect(maybank).toBeDefined();
    expect(maybank?.shortName).toBe('MAYBANK');
    expect(isKlci30('1155')).toBe(true);
  });

  it('rejects codes outside the universe', () => {
    expect(isKlci30('9999')).toBe(false);
    expect(getKlci30Row('9999')).toBeUndefined();
  });
});
