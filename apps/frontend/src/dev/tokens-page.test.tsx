import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isNotFound } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { CONTRAST_PAIRS, contrastRatio, type TokenReader } from './contrast'
import { TokensPage } from './tokens-page'
import { Route } from '../routes/[_]tokens'

/** jsdom does not run Tailwind, so read raw tokens straight from the real styles.css. */
const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8')
const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
const readToken: TokenReader = (name) =>
  new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(rootBlock)?.[1].trim() ?? ''

describe('/_tokens route', () => {
  it('is registered with a component in dev', () => {
    expect(import.meta.env.DEV).toBe(true)
    expect(Route.options.component).toBeDefined()
  })

  it('refuses to load outside dev (production build stub)', () => {
    vi.stubEnv('DEV', false)
    try {
      let thrown: unknown
      try {
        ;(Route.options.beforeLoad as () => void)()
      } catch (e) {
        thrown = e
      }
      expect(isNotFound(thrown)).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('renders a single h1 and the real shared components', () => {
    render(<TokensPage readToken={readToken} />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    for (const name of ['Surfaces and borders', 'Market colours', 'Status and provenance', 'Contrast']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    }
    // Real ChangeChip: sign + arrow + screen-reader word
    expect(screen.getAllByText('+1.24%').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Down').length).toBeGreaterThan(0)
    // Real provenance badges carry text
    expect(screen.getAllByText('Synthetic data').length).toBeGreaterThan(0)
    // Real Table: selected row is exposed, not colour-only
    const movers = screen.getByRole('table', { name: 'Top movers (synthetic)' })
    expect(within(movers).getByText('TENAGA').closest('tr')).toHaveAttribute('aria-current', 'true')
  })

  it('shows every contrast pair with a text result and all of them pass', () => {
    render(<TokensPage readToken={readToken} />)
    const table = screen.getByRole('table', { name: 'Contrast ratios for token pairs' })
    expect(within(table).getAllByRole('row')).toHaveLength(CONTRAST_PAIRS.length + 1)
    expect(within(table).queryByText('FAIL')).not.toBeInTheDocument()
    expect(within(table).queryByText('Unknown')).not.toBeInTheDocument()
    expect(screen.getByTestId('contrast-summary')).toHaveTextContent('All pass')
  })
})

describe('contrast helpers', () => {
  it('computes the DESIGN.md ratio for --fg on --surface-0', () => {
    expect(contrastRatio('--fg', '--surface-0', readToken)).toBeCloseTo(15.99, 1)
  })

  it('blends a translucent token onto its parent surface', () => {
    expect(contrastRatio('--up', '--up-bg@--surface-1', readToken)).toBeCloseTo(7.42, 1)
  })

  it('returns null for an unknown token or a translucent token without a parent', () => {
    expect(contrastRatio('--nope', '--surface-0', readToken)).toBeNull()
    expect(contrastRatio('--fg', '--up-bg', readToken)).toBeNull()
  })
})
