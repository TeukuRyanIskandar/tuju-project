/**
 * Deterministic seeded PRNG for the synthetic co-generation generator (spec 01,
 * decision A1). Pure — no `Math.random`, no global state — so the same seed
 * reproduces byte-identical output across runs and machines.
 *
 * `splitmix64` derives a 64-bit state from the seed; `mulberry32` streams the
 * uniform doubles. Both are tiny, well-known, and fully deterministic. We keep
 * the whole thing in 32-bit space after seeding so results are identical on any
 * JS engine (no `BigInt` in the hot path, no float-endianness surprises).
 */

/** Mixes a 32-bit seed into a well-distributed 32-bit start state (splitmix32). */
function splitmix32(seed: number): number {
  let z = seed >>> 0;
  z = (z + 0x9e3779b9) >>> 0;
  let t = z;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
  return (t ^ (t >>> 15)) >>> 0;
}

/**
 * A deterministic stream of uniforms in `[0, 1)` (mulberry32). Construct one per
 * logical stream so, e.g., price noise and financial jitter don't interfere.
 */
export class Prng {
  private state: number;

  constructor(seed: number) {
    // Fold the (possibly large) seed into 32 bits then mix, so seed `1` and seed
    // `1 + 2^32` don't collide trivially and low seeds still spread out.
    this.state = splitmix32(seed >>> 0) >>> 0;
  }

  /** Next uniform double in `[0, 1)`. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform double in `[min, max)`. */
  nextInRange(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /**
   * Standard-normal sample via Box–Muller (deterministic given the stream).
   * One call consumes two uniforms; we only ever return the first of the pair
   * so the stream position is predictable per call.
   */
  nextGaussian(): number {
    let u1 = this.next();
    // Guard against log(0).
    if (u1 < 1e-12) u1 = 1e-12;
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

/**
 * Derive an independent 32-bit sub-seed from a base seed and a string label, so
 * each logical stream (`prices`, `financials`, `dividends`) is reproducible and
 * independent. Deterministic FNV-1a over the label folded into the base seed.
 */
export function deriveSeed(baseSeed: number, label: string): number {
  let h = 0x811c9dc5 ^ (baseSeed >>> 0);
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
