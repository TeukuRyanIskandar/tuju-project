import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '#/test/render-app'

const PAGES = [
  ['/', 'Market overview'],
  ['/stocks/1155', 'Stock 1155'],
  ['/screener', 'Screener'],
  ['/announcements', 'Announcements'],
  ['/calendar', 'Calendar'],
  ['/news', 'News'],
  ['/ipo/abc-123', 'Prospectus at a glance'],
] as const

describe('routes', () => {
  it.each(PAGES)('%s renders inside the shell', async (path, heading) => {
    await renderApp(path)
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('marks the current nav link', async () => {
    await renderApp('/screener')
    expect(await screen.findByRole('link', { name: 'Screener' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Market' })).not.toHaveAttribute('aria-current')
  })

  it('shows the not-found page for an unknown path', async () => {
    await renderApp('/does-not-exist')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to market overview' })).toHaveAttribute('href', '/')
  })
})
