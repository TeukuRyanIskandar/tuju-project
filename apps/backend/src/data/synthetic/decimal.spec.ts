import {
  add,
  cmp,
  divide,
  fromNumber,
  fromString,
  fromUnits,
  mul,
  rescale,
  sub,
  toStringAtScale,
} from './decimal';

/**
 * Fixed-point primitive tests (ticket 03). These pin the exact-arithmetic
 * behaviour the reconciliation guarantee stands on: parsing, half-up rounding,
 * and integer division producing a fixed number of places.
 */
describe('decimal primitives', () => {
  it('parses and renders a numeric string at scale', () => {
    const d = fromString('12.345678', 6);
    expect(toStringAtScale(d, 6)).toBe('12.345678');
  });

  it('pads shorter fractional strings to scale', () => {
    expect(toStringAtScale(fromString('2.5', 6), 6)).toBe('2.500000');
  });

  it('parses negatives', () => {
    expect(toStringAtScale(fromString('-3.14', 2), 2)).toBe('-3.14');
  });

  it('add / sub align scales', () => {
    const a = fromString('1.50', 2);
    const b = fromString('0.250', 3);
    expect(toStringAtScale(add(a, b), 3)).toBe('1.750');
    expect(toStringAtScale(sub(a, b), 3)).toBe('1.250');
  });

  it('mul sums scales', () => {
    const a = fromString('2.5', 6); // scale 6
    const shares = fromUnits(500000000n, 0);
    const cap = mul(a, shares); // 2.5 * 5e8 = 1.25e9
    expect(toStringAtScale(cap, 2)).toBe('1250000000.00');
  });

  it('divide rounds half-up away from zero to the result scale', () => {
    // 1 / 3 = 0.333333...
    expect(toStringAtScale(divide(fromUnits(1n, 0), fromUnits(3n, 0), 6), 6)).toBe(
      '0.333333',
    );
    // 2 / 3 = 0.666667 (rounds up)
    expect(toStringAtScale(divide(fromUnits(2n, 0), fromUnits(3n, 0), 6), 6)).toBe(
      '0.666667',
    );
    // exact halves round up
    expect(toStringAtScale(divide(fromUnits(1n, 0), fromUnits(2n, 0), 1), 1)).toBe(
      '0.5',
    );
    expect(toStringAtScale(divide(fromUnits(1n, 0), fromUnits(8n, 0), 2), 2)).toBe(
      '0.13',
    );
  });

  it('divide handles negatives symmetrically', () => {
    expect(
      toStringAtScale(divide(fromUnits(-2n, 0), fromUnits(3n, 0), 6), 6),
    ).toBe('-0.666667');
  });

  it('throws on divide by zero', () => {
    expect(() => divide(fromUnits(1n, 0), fromUnits(0n, 0), 2)).toThrow();
  });

  it('rescale rounds half-up when shrinking', () => {
    expect(toStringAtScale(rescale(fromString('1.005', 3), 2), 2)).toBe('1.01');
    expect(toStringAtScale(rescale(fromString('1.004', 3), 2), 2)).toBe('1.00');
  });

  it('fromNumber rounds half-up', () => {
    expect(toStringAtScale(fromNumber(2.005, 2), 2)).toBe('2.01');
    expect(toStringAtScale(fromNumber(-2.005, 2), 2)).toBe('-2.01');
  });

  it('cmp orders across scales', () => {
    expect(cmp(fromString('1.50', 2), fromString('1.5', 1))).toBe(0);
    expect(cmp(fromString('1.49', 2), fromString('1.5', 1))).toBe(-1);
    expect(cmp(fromString('1.51', 2), fromString('1.5', 1))).toBe(1);
  });
});
