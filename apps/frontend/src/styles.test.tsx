import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { cn } from '#/lib/utils'

/**
 * Smoke test for ticket 06. jsdom does not run Tailwind, so this does NOT prove
 * a utility resolves to a colour. It proves (a) a token-backed utility class is
 * rendered as written, (b) cn() merges conflicting utilities, and (c) every
 * DESIGN.md token still exists in src/styles.css. The build step is what proves
 * Tailwind accepts the stylesheet.
 */
const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8')

// Raw tokens declared in :root (DESIGN.md colour, shape, motion tables).
const rootTokens = [
  '--surface-0', '--surface-1', '--surface-2', '--surface-3',
  '--border', '--border-strong', '--control-border',
  '--fg', '--fg-2', '--fg-3',
  '--accent', '--accent-fg', '--accent-soft',
  '--up', '--up-bg', '--up-border',
  '--down', '--down-bg', '--down-border',
  '--unch', '--unch-bg',
  '--tick-flash-up', '--tick-flash-down',
  '--info', '--warn', '--danger',
  '--ai', '--ai-bg', '--synthetic', '--synthetic-bg',
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6',
  '--row-h', '--control-h', '--motion-fast',
  '--font-ui',
  // shadcn semantic variables
  '--background', '--foreground', '--card', '--card-foreground',
  '--popover', '--popover-foreground', '--primary', '--primary-foreground',
  '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
  '--destructive', '--input', '--ring', '--radius',
]

/** Returns the declared value of `name` in the `:root { ... }` block. */
function rootValue(name: string): string | undefined {
  const block = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(block)
  return match?.[1].trim()
}

describe('design tokens', () => {
  it('renders a token-backed utility class', () => {
    render(
      <p data-testid="price" className="num bg-surface-1 text-up border-border">
        1,642.18
      </p>,
    )
    const el = screen.getByTestId('price')
    expect(el).toHaveClass('num', 'bg-surface-1', 'text-up', 'border-border')
    expect(el).toHaveTextContent('1,642.18')
  })

  it('cn() lets the later conflicting utility win', () => {
    expect(cn('text-fg-2 px-2', false && 'hidden', 'text-fg')).toBe('px-2 text-fg')
  })

  it.each(rootTokens)('declares %s in :root', (token) => {
    expect(rootValue(token), `${token} missing from :root`).toBeTruthy()
  })

  it('keeps Tuju --accent as the raw blue, not shadcn hover surface', () => {
    expect(rootValue('--accent')).toBe('#5b9bff')
    expect(rootValue('--primary')).toBe('var(--accent)')
    expect(css).toMatch(/--color-accent:\s*var\(--surface-3\)/)
  })

  it('sets the explicit radius scale', () => {
    expect(css).toMatch(/--radius-sm:\s*2px/)
    expect(css).toMatch(/--radius-md:\s*3px/)
    expect(css).toMatch(/--radius-lg:\s*4px/)
  })

  it('exposes Tuju tokens to Tailwind via @theme inline', () => {
    for (const name of ['up', 'down', 'unch', 'ai', 'synthetic', 'warn', 'info', 'fg-2', 'fg-3', 'surface-3', 'chart-6']) {
      expect(css).toContain(`--color-${name}: var(--${name});`)
    }
  })

  it('has no box-shadow declarations, no Google Fonts, and a reduced-motion guard', () => {
    expect(css).not.toMatch(/box-shadow\s*:/)
    expect(css).not.toContain('fonts.googleapis.com')
    expect(css).toContain('prefers-reduced-motion: reduce')
  })
})
