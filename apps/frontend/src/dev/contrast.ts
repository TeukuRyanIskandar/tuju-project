/**
 * WCAG contrast helpers for the `/_tokens` dev route.
 *
 * Specs are `--token` or `--tint@--parent`: a translucent token blended onto its
 * parent surface first, because text sits on the blended colour and not on the
 * flat surface (DESIGN.md "Accessibility: what was checked").
 */

export type Rgb = [number, number, number]

/** Reads a CSS custom property, e.g. `read('--fg')` -> `'#e6e9ee'`. */
export type TokenReader = (name: string) => string

/** Parses `#rrggbb` or `rgb()/rgba()` into channels and alpha. */
export function parseColor(value: string): { rgb: Rgb; a: number } | null {
  const v = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) {
    const rgb = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) as Rgb
    return { rgb, a: 1 }
  }
  if (/^rgba?\(/i.test(v)) {
    const nums = (v.match(/[\d.]+/g) ?? []).map(Number)
    if (nums.length < 3 || nums.some((n) => !Number.isFinite(n))) return null
    return { rgb: [nums[0], nums[1], nums[2]], a: nums[3] ?? 1 }
  }
  return null
}

/** Resolves a spec to opaque RGB, or null when a token is missing or unparsable. */
export function resolveColor(spec: string, read: TokenReader): Rgb | null {
  const [token, parent] = spec.split('@')
  const parsed = parseColor(read(token))
  if (!parsed) return null
  if (parsed.a === 1) return parsed.rgb
  if (!parent) return null
  const bg = resolveColor(parent, read)
  if (!bg) return null
  return parsed.rgb.map((c, i) => Math.round(c * parsed.a + bg[i] * (1 - parsed.a))) as Rgb
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two specs, or null when either cannot be resolved. */
export function contrastRatio(fg: string, bg: string, read: TokenReader): number | null {
  const a = resolveColor(fg, read)
  const b = resolveColor(bg, read)
  if (!a || !b) return null
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export const TEXT_MIN = 4.5
/** UI boundaries and graphics (WCAG 1.4.11). */
export const UI_MIN = 3

export type ContrastPair = readonly [fg: string, bg: string, min: number]

const T = TEXT_MIN
const U = UI_MIN

/** Same pairs as `docs/tokens-preview.html`. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ['--fg', '--surface-0', T], ['--fg', '--surface-3', T],
  ['--fg-2', '--surface-1', T], ['--fg-2', '--surface-3', T], ['--fg-2', '--accent-soft@--surface-1', T],
  ['--fg-3', '--surface-0', T], ['--fg-3', '--surface-1', T], ['--fg-3', '--surface-2', T], ['--fg-3', '--surface-3', T],
  ['--fg-3', '--accent-soft@--surface-1', T], ['--fg-3', '--ai-bg@--surface-1', T], ['--fg-3', '--synthetic-bg@--surface-1', T],
  ['--up', '--surface-1', T], ['--up', '--surface-3', T], ['--up', '--up-bg@--surface-1', T], ['--up', '--accent-soft@--surface-1', T],
  ['--down', '--surface-1', T], ['--down', '--surface-3', T], ['--down', '--down-bg@--surface-1', T], ['--down', '--accent-soft@--surface-1', T],
  ['--unch', '--surface-1', T], ['--unch', '--surface-3', T], ['--unch', '--unch-bg@--surface-1', T],
  ['--accent', '--surface-1', T], ['--accent', '--accent-soft@--surface-1', T], ['--accent', '--accent-soft@--surface-2', T], ['--accent-fg', '--accent', T],
  ['--info', '--surface-1', T], ['--warn', '--surface-1', T], ['--danger', '--surface-1', T],
  ['--ai', '--ai-bg@--surface-1', T], ['--synthetic', '--synthetic-bg@--surface-1', T],
  ['--surface-0', '--up', T], ['--surface-0', '--down', T], ['--surface-0', '--chart-1', T],
  ['--control-border', '--surface-0', U], ['--control-border', '--surface-1', U], ['--control-border', '--surface-2', U], ['--control-border', '--surface-3', U],
  ['--chart-1', '--surface-1', U], ['--chart-2', '--surface-1', U], ['--chart-3', '--surface-1', U],
  ['--chart-4', '--surface-1', U], ['--chart-5', '--surface-1', U], ['--chart-6', '--surface-1', U],
]
