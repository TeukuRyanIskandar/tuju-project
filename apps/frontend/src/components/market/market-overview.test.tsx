import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from '#/test/render-app'
import { marketNumber } from './market-overview'

const sector = { id: 'sector-first', kind: 'sector', name: 'Not the headline', sectorName: 'Energy', level: '8', pctChange: 0, provenance: 'real' }
const headline = { id: 'returned-headline', kind: 'headline', name: 'Synthetic analogue', sectorName: null, level: '1234.50', pctChange: null, provenance: 'synthetic' }
let missingHeadline = false
let failHistory = false
let failMovers = false
let emptySectors = false
let pendingSectors = false
let failStockAnalysis = false
let failProspectus = false
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  missingHeadline = failHistory = failMovers = emptySectors = pendingSectors = failStockAnalysis = failProspectus = false
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://test')
    if (url.pathname.endsWith('/auth/me')) return new Response('{}', { status: 401 })
    if (url.pathname === '/stocks/1155') return Response.json({ identity: { provenance: 'real', stockCode: '1155', shortName: 'MAYBANK', fullName: 'Malayan Banking Berhad', companyName: 'Malayan Banking Berhad', board: 'MAIN', sector: 'Financial Services' }, fundamentals: null, technicals: null, shariah: { provenance: 'real', status: null, effectiveDate: null } })
    if (url.pathname === '/stocks/1155/analysis/technical') return failStockAnalysis ? new Response('{}', { status: 503 }) : Response.json({ code: '1155', jobName: 'analyze-technical', status: 'ready', headline: 'Grounded technical preview', asOf: '2026-10-16T08:44:00.000Z', artifact: { bucket: 'private', key: 'private' }, artifactPath: '/private', errorMessage: null })
    if (url.pathname === '/stocks/1155/analysis/fundamental') return Response.json({ code: '1155', jobName: 'analyze-fundamental', status: 'pending', headline: null, asOf: null, artifact: null, artifactPath: null, errorMessage: null })
    if (url.pathname === '/ipo/094fd734-c812-4bcf-921d-72dea6f21fb6/at-a-glance') return failProspectus ? new Response('{}', { status: 503 }) : Response.json({ prospectusId: '094fd734-c812-4bcf-921d-72dea6f21fb6', companyName: 'Insights Analytics Berhad', board: 'ACE', listingDate: '2025-10-27', offerPrice: '0.360000', headline: 'Prospectus preview headline', asOf: '2026-10-16T08:45:00.000Z', source: 'real', artifact: { bucket: 'private', key: 'private' }, artifactPath: '/private' })
    if (url.pathname.endsWith('/market/indices')) return Response.json({ indices: missingHeadline ? [sector] : [sector, headline] })
    if (url.pathname.includes('/series')) return failHistory ? new Response('{}', { status: 503 }) : Response.json({ id: headline.id, name: headline.name, range: url.searchParams.get('range'), provenance: 'synthetic', points: [{ levelDate: '2026-10-01', level: '1230.20' }, { levelDate: '2026-10-02', level: 'bad' }, { levelDate: '2026-10-03', level: '1234.50' }] })
    if (url.pathname.endsWith('/market/movers')) return failMovers ? new Response('{}', { status: 503 }) : Response.json({ type: url.searchParams.get('type'), limit: 10, rows: [
      { stockCode: '1155', shortName: 'MAYBANK', price: '10.25', pctChange: null, volume: 123456, provenance: 'aggregator' },
      { stockCode: '1023', shortName: 'CIMB', price: 'oops', pctChange: -1.5, volume: 10, provenance: 'real' },
    ] })
    if (url.pathname.endsWith('/market/sectors')) {
      if (pendingSectors) return new Promise<Response>(() => {})
      return Response.json({ sectors: emptySectors ? [] : [{ indexId: 'energy', sectorName: 'Energy', level: '9.50', pctChange: 1.2, provenance: 'synthetic' }] })
    }
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const calls = () => fetchMock.mock.calls.map(([url]) => String(url))
const panel = (name: string) => within(screen.getAllByRole('region', { name })[0]!)

describe('market overview', () => {
  it('selects headline by kind, uses its returned ID, defaults and isolated supported controls', async () => {
    await renderApp()
    expect(await panel('Headline snapshot').findByText('1,234.50')).toBeInTheDocument()
    await screen.findByRole('img', { name: /Index level history/ })
    expect(calls().some((url) => url.endsWith('/market/indices/returned-headline/series?range=1m'))).toBe(true)
    expect(calls().some((url) => url.endsWith('/market/movers?type=gainers&limit=10'))).toBe(true)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '3m' }))
    await waitFor(() => expect(calls().some((url) => url.endsWith('/series?range=3m'))).toBe(true))
    await user.click(screen.getByRole('button', { name: '1y' }))
    await waitFor(() => expect(calls().some((url) => url.endsWith('/series?range=1y'))).toBe(true))
    await user.click(screen.getByRole('button', { name: 'Losers' }))
    await waitFor(() => expect(calls().some((url) => url.endsWith('/movers?type=losers&limit=10'))).toBe(true))
    await user.click(screen.getByRole('button', { name: 'Most active' }))
    await waitFor(() => expect(calls().some((url) => url.endsWith('/movers?type=actives&limit=10'))).toBe(true))
    expect(panel('Headline snapshot').getByText('1,234.50')).toBeInTheDocument()
  })

  it('discovers the verified stock and prospectus using thin API reads only', async () => {
    const { router } = await renderApp()
    const stockLink = await screen.findByRole('link', { name: /1155.*MAYBANK/ })
    expect(stockLink).toHaveAttribute('href', '/stocks/1155')
    expect(await screen.findByText(/Technical analysis: ready/)).toBeInTheDocument()
    expect(screen.getByText(/Fundamental analysis: pending/)).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Insights Analytics Berhad/ })).toHaveAttribute('href', '/ipo/094fd734-c812-4bcf-921d-72dea6f21fb6')
    expect(await screen.findByText('Prospectus preview headline')).toBeInTheDocument()
    expect(screen.getByText(/Prepared prospectus summaries/)).toBeInTheDocument()
    expect(screen.getByText(/Curated examples are system-precomputed/)).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(calls()).toContain('/stocks/1155')
    expect(calls()).toContain('/stocks/1155/analysis/technical')
    expect(calls()).toContain('/stocks/1155/analysis/fundamental')
    expect(calls()).toContain('/ipo/094fd734-c812-4bcf-921d-72dea6f21fb6/at-a-glance')
    expect(calls().some(url => url.includes('/artifact') || url.includes('/jobs'))).toBe(false)
  })

  it('keeps preview errors local and retryable without replacing examples', async () => {
    failStockAnalysis = failProspectus = true
    await renderApp()
    expect(await screen.findByRole('link', { name: /1155.*Stock/ })).toHaveAttribute('href', '/stocks/1155')
    expect(await screen.findByText('Prospectus preview unavailable')).toBeInTheDocument()
    expect(await screen.findByText('Stock analysis preview unavailable')).toBeInTheDocument()
    const callsBeforeRetry = calls().length
    await userEvent.click(panel('Automatic stock analysis').getByRole('button', { name: 'Try again' }))
    await userEvent.click(panel('Prospectus at a glance').getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(calls().length).toBeGreaterThan(callsBeforeRetry))
  })

  it('shows truthful per-row provenance, unavailable values, plain volume and stock navigation', async () => {
    const { router } = await renderApp()
    const link = await screen.findByRole('link', { name: /1155.*MAYBANK/ })
    expect(link).toHaveAttribute('href', '/stocks/1155')
    expect(panel('Market movers').getByText('RM 10.250')).toBeInTheDocument()
    expect(panel('Market movers').getByText('123,456')).not.toHaveAttribute('data-direction')
    expect(panel('Market movers').getByText('No change data')).toBeInTheDocument()
    expect(panel('Market movers').getByRole('cell', { name: '—' })).toBeInTheDocument()
    expect(panel('Market movers').getByText(/Aggregator · private demo/)).toBeInTheDocument()
    expect(panel('Market movers').getByText(/Real source/)).toBeInTheDocument()
    expect(await panel('Headline snapshot').findByText('Synthetic data')).toBeInTheDocument()
    expect(panel('Headline snapshot').getByText(/Retrieved .*Quote time unavailable/)).toBeInTheDocument()
    await userEvent.click(link)
    await waitFor(() => expect(router.state.location.pathname).toBe('/stocks/1155'))
  })

  it('disables history without a headline while other panels remain usable', async () => {
    missingHeadline = true
    await renderApp()
    expect(await panel('Headline snapshot').findByText('No data available')).toBeInTheDocument()
    expect(screen.getByText('History unavailable without a headline index')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1m' })).toBeDisabled()
    expect(await screen.findByText('Energy')).toBeInTheDocument()
    expect(calls().some((url) => url.includes('/series'))).toBe(false)
  })

  it('keeps history errors local and unrelated loading independent', async () => {
    failHistory = true
    pendingSectors = true
    await renderApp()
    expect(await panel('Index history').findByRole('alert')).toHaveTextContent('Panel unavailable')
    expect(panel('Headline snapshot').getByText('1,234.50')).toBeInTheDocument()
    expect(panel('Sector board').getByRole('status')).toHaveTextContent('Loading')
    expect(await screen.findByText('RM 10.250')).toBeInTheDocument()
  })

  it('retains cached rows and their retrieval time on refresh failure, then recovers locally', async () => {
    emptySectors = true
    await renderApp()
    await screen.findByText('RM 10.250')
    expect(await panel('Sector board').findByText('No data available')).toBeInTheDocument()
    const timestamp = panel('Market movers').getByText(/Retrieved/).textContent
    failMovers = true
    await userEvent.click(panel('Market movers').getByRole('button', { name: 'Refresh' }))
    expect(await panel('Market movers').findByRole('alert')).toHaveTextContent('Refresh failed — showing retained data')
    expect(panel('Market movers').getByText('RM 10.250')).toBeInTheDocument()
    expect(panel('Market movers').getByText(/Retrieved/).textContent).toBe(timestamp)
    expect(panel('Headline snapshot').queryByRole('alert')).not.toBeInTheDocument()
    failMovers = false
    await userEvent.click(panel('Market movers').getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(panel('Market movers').queryByRole('alert')).not.toBeInTheDocument())
  })

  it('offers keyboard date/value inspection and does not plot malformed levels', async () => {
    await renderApp()
    await screen.findByRole('img', { name: /Index level history/ })
    const summary = screen.getByText('Inspect history dates and values')
    summary.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('table', { name: 'Index history dates and values' })).toBeInTheDocument()
    expect(screen.getByText('1 Oct 2026')).toBeInTheDocument()
    expect(panel('Index history').getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('img').querySelectorAll('circle')).toHaveLength(2)
    expect(screen.getByRole('img').querySelectorAll('line')).toHaveLength(0)
  })
})

describe('market numeric boundary', () => {
  it.each([null, undefined, '', ' ', 'bad', '1,000', '0x20', 'Infinity', Infinity, NaN, {}, true])('rejects unavailable/malformed %j', (value) => expect(marketNumber(value)).toBeNull())
  it.each([['123.50', 123.5], ['0', 0], [' -.25 ', -0.25], [2, 2]])('parses %j', (value, expected) => expect(marketNumber(value)).toBe(expected))
})
