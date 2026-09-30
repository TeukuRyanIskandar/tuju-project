/**
 * Exact fixed-point decimal helpers for the synthetic generator (spec 01).
 *
 * Prices and fundamentals land in Postgres `numeric` columns and every derived
 * ratio must reconcile *exactly* against them — so the generator never carries a
 * value as a float once it is "emitted". Instead each figure is a `Decimal`:
 * an integer `units` scaled by a fixed number of decimal places (`scale`). All
 * arithmetic is integer arithmetic (via `BigInt`), and rounding is explicit
 * half-up, matching how the reconciliation test recomputes the same ratios.
 *
 * This keeps the A1 guarantee mechanical: given the emitted `numeric` strings,
 * `divide(a, b, scale)` produces the identical string the generator wrote onto
 * the {@link FundamentalsSnapshot}.
 */

export interface Decimal {
  /** Signed integer value = the real number × 10^scale. */
  readonly units: bigint;
  /** Number of decimal places. */
  readonly scale: number;
}

const TEN = 10n;

function pow10(n: number): bigint {
  let r = 1n;
  for (let i = 0; i < n; i++) r *= TEN;
  return r;
}

/** Build a Decimal from an integer count of scaled units. */
export function fromUnits(units: bigint, scale: number): Decimal {
  return { units, scale };
}

/**
 * Parse a Decimal from a plain numeric string (e.g. an emitted `PriceBar.close`)
 * at a target scale. Throws on malformed input — callers only pass emitted DTO
 * strings, so a throw means a generator bug, not bad user data.
 */
export function fromString(value: string, scale: number): Decimal {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`fromString: not a numeric string: ${value}`);
  const sign = m[1] === '-' ? -1n : 1n;
  const intPart = m[2];
  const fracPart = m[3] ?? '';
  const fracPadded = (fracPart + '0'.repeat(scale)).slice(0, scale);
  const raw = BigInt(intPart + fracPadded);
  return { units: sign * raw, scale };
}

/** Build a Decimal from a JS number by rounding to `scale` places (half-up). */
export function fromNumber(value: number, scale: number): Decimal {
  const factor = 10 ** scale;
  const scaled = value * factor;
  const rounded =
    scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5);
  return { units: BigInt(rounded), scale };
}

/** Rescale a Decimal to a new number of decimal places (half-up on shrink). */
export function rescale(a: Decimal, scale: number): Decimal {
  if (a.scale === scale) return a;
  if (scale > a.scale) {
    return { units: a.units * pow10(scale - a.scale), scale };
  }
  const div = pow10(a.scale - scale);
  const half = div / 2n;
  const q = a.units / div;
  const r = a.units % div;
  const absR = r < 0n ? -r : r;
  let rounded = q;
  if (absR * 2n >= div || absR >= half + (div % 2n)) {
    // half-up away from zero
    rounded = a.units >= 0n ? q + 1n : q - 1n;
  }
  return { units: rounded, scale };
}

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [rescale(a, scale).units, rescale(b, scale).units, scale];
}

export function add(a: Decimal, b: Decimal): Decimal {
  const [au, bu, scale] = align(a, b);
  return { units: au + bu, scale };
}

export function sub(a: Decimal, b: Decimal): Decimal {
  const [au, bu, scale] = align(a, b);
  return { units: au - bu, scale };
}

/** Multiply two decimals; result scale is the sum of input scales. */
export function mul(a: Decimal, b: Decimal): Decimal {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

/**
 * Divide `a / b` producing `resultScale` decimal places, rounded half-up away
 * from zero. This is THE reconciliation primitive: every ratio the generator
 * emits and every ratio the test recomputes both flow through this same op.
 */
export function divide(a: Decimal, b: Decimal, resultScale: number): Decimal {
  if (b.units === 0n) throw new Error('divide: division by zero');
  // Scale the numerator up so the integer division yields `resultScale` places.
  const numScale = a.scale - b.scale;
  const shift = resultScale - numScale + 1; // +1 guard digit for rounding
  let num = a.units;
  let den = b.units;
  if (shift >= 0) {
    num *= pow10(shift);
  } else {
    den *= pow10(-shift);
  }
  // Work in positive space, track sign, so half-up is symmetric.
  const negative = num < 0n !== den < 0n;
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;
  const guarded = absNum / absDen;
  const lastDigit = guarded % TEN;
  let rounded = guarded / TEN;
  if (lastDigit >= 5n) rounded += 1n;
  return { units: negative ? -rounded : rounded, scale: resultScale };
}

/** Compare two decimals: negative / zero / positive like a comparator. */
export function cmp(a: Decimal, b: Decimal): number {
  const [au, bu] = align(a, b);
  if (au < bu) return -1;
  if (au > bu) return 1;
  return 0;
}

export function isZero(a: Decimal): boolean {
  return a.units === 0n;
}

export function isNegativeOrZero(a: Decimal): boolean {
  return a.units <= 0n;
}

/** Render as a fixed-scale plain numeric string (matches Postgres `numeric`). */
export function toStringAtScale(a: Decimal, scale: number): string {
  const r = rescale(a, scale);
  const negative = r.units < 0n;
  const abs = negative ? -r.units : r.units;
  const s = abs.toString().padStart(scale + 1, '0');
  const intPart = scale === 0 ? s : s.slice(0, s.length - scale);
  const fracPart = scale === 0 ? '' : s.slice(s.length - scale);
  const body = scale === 0 ? intPart : `${intPart}.${fracPart}`;
  return negative && abs !== 0n ? `-${body}` : body;
}

/** Render at the Decimal's own scale. */
export function toString(a: Decimal): string {
  return toStringAtScale(a, a.scale);
}
