import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderApp } from '#/test/render-app'

const provenance = { provenance: 'real' }
let failCore = false
let failSeries = false
let mismatch = false
let fetchMock: ReturnType<typeof vi.fn<(input: string) => Promise<Response>>>
beforeEach(() => {
  failCore = failSeries = mismatch = false
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://test')
    const code = url.pathname.split('/stocks/')[1]?.split('/')[0]
    if (!code) return new Response('{}', { status: 401 })
    if (url.pathname.includes('/analysis/')) return new Response('{}', { status: 404 })
    if (url.pathname.endsWith('/series')) return failSeries ? new Response('{}', { status: 503 }) : Response.json({
      code: mismatch ? 'WRONG' : code, interval: '1d', range: '2y', provenance: 'real', demoLabel: 'private-demo', points: [
        { date: '2025-01-01', open: '1', high: '1', low: '1', close: '1', volume: '1' },
        { date: '2026-10-01', open: '1', high: '1', low: '1', close: '10.25', volume: '0' },
        { date: '2026-10-02', open: '1', high: '1', low: '1', close: 'bad', volume: '20' },
        { date: '2026-10-03', open: '1', high: '1', low: '1', close: '11', volume: '30' },
      ],
    })
    return failCore ? new Response('{}', { status: 404 }) : Response.json({
      identity: { ...provenance, stockCode: mismatch ? 'WRONG' : code, shortName: `Company ${code}`, fullName: `Full ${code}`, companyName: `Issuer ${code}`, board: 'MAIN', sector: 'Finance' },
      fundamentals: null, technicals: null,
      shariah: { ...provenance, status: null, effectiveDate: null },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
const panel = (name: string) => within(screen.getByRole('region', { name }))

it('loads a direct stock link, shows EOD vs retrieval provenance and filters without another series read', async () => {
  await renderApp('/stocks/1155')
  expect(await screen.findByRole('heading', { name: '1155 · Company 1155' })).toBeInTheDocument()
  await screen.findByRole('img', { name: /Daily EOD close/ })
  expect(screen.getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'true')
  expect(panel('Daily EOD history').getByText(/Latest stored EOD: 3 Oct 2026/)).toBeInTheDocument()
  expect(panel('Daily EOD history').getByText(/Retrieved .*not a quote timestamp/)).toBeInTheDocument()
  expect(panel('Daily EOD history').getByText(/Private demo/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '2Y' }))
  await userEvent.click(screen.getByText('Inspect daily data table'))
  expect(screen.getByRole('table', { name: 'Daily EOD dates, close and volume' })).toHaveTextContent('1 Jan 2025')
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/series'))).toHaveLength(1)
  const slider = screen.getByRole('slider', { name: 'Inspect trading day' })
  // jsdom does not implement native range keyboard behavior; browser test covers it.
  fireEvent.change(slider, { target: { value: '1' } })
  expect(slider).toHaveAttribute('aria-valuetext', '1 Oct 2026; close RM 10.250; volume 0')
})

it.each(['core', 'series'] as const)('keeps a %s failure local', async failure => {
  failCore = failure === 'core'
  failSeries = failure === 'series'
  await renderApp('/stocks/1155')
  expect(await panel(failCore ? 'Stock identity' : 'Daily EOD history').findByRole('alert')).toBeInTheDocument()
  if (failCore) expect(await screen.findByRole('img', { name: /Daily EOD close/ })).toBeInTheDocument()
  else expect(await screen.findByRole('heading', { name: '1155 · Company 1155' })).toBeInTheDocument()
   expect(await panel('Technical analysis').findByRole('alert')).toHaveTextContent('Analysis is not available')
})

it('rejects mismatched identities instead of showing another stock', async () => {
  mismatch = true
  await renderApp('/stocks/1155')
  await waitFor(() => expect(panel('Stock identity').getByRole('alert')).toBeInTheDocument())
  await waitFor(() => expect(panel('Daily EOD history').getByRole('alert')).toBeInTheDocument())
  expect(screen.queryByText(/Company WRONG/)).not.toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})

it('never carries a previous stock across route changes, including pending or failed reads', async () => {
  const { router } = await renderApp('/stocks/1155')
  await screen.findByRole('heading', { name: '1155 · Company 1155' })
  await screen.findByRole('img', { name: /Daily EOD close/ })
  fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
  await router.navigate({ to: '/stocks/$code', params: { code: '1023' } })
  await screen.findByRole('heading', { name: 'Stock 1023' })
  expect(screen.queryByText(/Company 1155/)).not.toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(panel('Daily EOD history').getByRole('status')).toHaveTextContent('Loading')
})

it('loads the new stock identity after navigation and never reuses an old chart on failure', async () => {
  const { router } = await renderApp('/stocks/1155')
  await screen.findByRole('heading', { name: '1155 · Company 1155' })
  await screen.findByRole('img', { name: /Daily EOD close/ })
  failSeries = true
  await router.navigate({ to: '/stocks/$code', params: { code: '1023' } })
  expect(await screen.findByRole('heading', { name: '1023 · Company 1023' })).toBeInTheDocument()
  expect(await panel('Daily EOD history').findByRole('alert')).toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.queryByText(/Company 1155/)).not.toBeInTheDocument()
})

it.each(['core', 'series'] as const)('does not let pending %s gate the other read', async pending => {
  const original = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((input: string) => {
    const isSeries = input.includes('/series')
    if (input.includes('/stocks/') && isSeries === (pending === 'series')) return new Promise<Response>(() => {})
    return original(input)
  })
  await renderApp('/stocks/1155')
  if (pending === 'core') expect(await screen.findByRole('img', { name: /Daily EOD close/ })).toBeInTheDocument()
  else expect(await screen.findByRole('heading', { name: '1155 · Company 1155' })).toBeInTheDocument()
  expect(panel(pending === 'core' ? 'Stock identity' : 'Daily EOD history').getByRole('status')).toHaveTextContent('Loading')
})

it('labels a same-code retained snapshot after refresh failure, preserves its retrieval time and recovers locally', async () => {
  await renderApp('/stocks/1155')
  await screen.findByRole('img', { name: /Daily EOD close/ })
  const timestamp = panel('Daily EOD history').getByText(/Retrieved/).textContent
  failSeries = true
  await userEvent.click(panel('Daily EOD history').getByRole('button', { name: 'Refresh' }))
  expect(await panel('Daily EOD history').findByRole('alert')).toHaveTextContent('Refresh failed — showing retained snapshot')
  expect(screen.getByRole('img')).toBeInTheDocument()
  expect(panel('Daily EOD history').getByText(/Retrieved/).textContent).toBe(timestamp)
  expect(panel('Stock identity').queryByRole('alert')).not.toBeInTheDocument()
  failSeries = false
  await userEvent.click(panel('Daily EOD history').getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(panel('Daily EOD history').queryByRole('alert')).not.toBeInTheDocument())
})
