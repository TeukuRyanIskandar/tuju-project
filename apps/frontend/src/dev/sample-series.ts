/** Seeded synthetic OHLCV data for the `/_tokens` chart specimens. Not market data. */

export interface Bar {
  date: Date
  o: number
  h: number
  l: number
  c: number
  v: number
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `n` weekday bars from 4 May 2026, deterministic for a given seed. */
export function syntheticSeries(seed: number, start: number, n: number, drift: number): Bar[] {
  const rand = mulberry32(seed)
  const out: Bar[] = []
  let close = start
  const d = new Date(Date.UTC(2026, 4, 4))
  while (out.length < n) {
    if (d.getUTCDay() % 6 !== 0) {
      const open = close
      const chg = (rand() - 0.5 + drift) * 0.026
      close = +(open * (1 + chg)).toFixed(2)
      const h = +(Math.max(open, close) * (1 + rand() * 0.009)).toFixed(2)
      const l = +(Math.min(open, close) * (1 - rand() * 0.009)).toFixed(2)
      const v = Math.round((4e6 + rand() * 9e6) * (1 + Math.abs(chg) * 28))
      out.push({ date: new Date(d), o: open, h, l, c: close, v })
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/** Simple moving average of closes; null until `period` bars exist. */
export function movingAverage(data: Bar[], period: number): (number | null)[] {
  return data.map((_, i) =>
    i < period - 1 ? null : data.slice(i - period + 1, i + 1).reduce((sum, b) => sum + b.c, 0) / period,
  )
}

/** Round-number axis ticks between `lo` and `hi`. */
export function niceTicks(lo: number, hi: number, want: number): number[] {
  const raw = (hi - lo) / want
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(+t.toFixed(4))
  return out
}
