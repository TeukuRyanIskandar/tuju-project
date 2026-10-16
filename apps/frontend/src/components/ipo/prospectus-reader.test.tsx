import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { ProspectusArtifact } from '@tuju/contracts'
import fixture from '../../../../../packages/contracts/fixtures/prospectus-artifact.json'
import { ProspectusArtifactView } from './prospectus-reader'
import { renderApp } from '#/test/render-app'

function artifact(): ProspectusArtifact {
  return structuredClone(fixture) as unknown as ProspectusArtifact
}

it('renders all five sections, supporting insights, and preserves financial strings', async () => {
  const user = userEvent.setup()
  render(<ProspectusArtifactView artifact={artifact()} />)
  expect(screen.getAllByText('Manufactures and supplies industrial components in Malaysia.')).toHaveLength(2)
  expect(screen.getByText('Revenue and profit grew every year over the three-year track record.')).toBeInTheDocument()
  expect(screen.getByText('Customer concentration')).toBeInTheDocument()
  expect(screen.getByText(/high severity/)).toBeInTheDocument()
  expect(screen.getByText('100m')).toBeInTheDocument()
  expect(screen.getByText('Analysis source section: risk-factors (not a verified page citation)')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Financials' })).toHaveAttribute('href', '#financials')
  await user.click(screen.getByText('Use of proceeds'))
  expect(screen.getAllByText('Capacity expansion')).toHaveLength(2)
  const proceedsScroll = screen.getByRole('region', { name: 'Use of proceeds table' })
  expect(proceedsScroll).toHaveAttribute('tabindex', '0')
  await user.tab()
  expect(proceedsScroll).toHaveFocus()
  const shariah = screen.getByText('Shariah status')
  await user.click(shariah)
  expect(screen.getByText(/compliant/)).toBeInTheDocument()
})

it('keeps legacy optional insights and limited extractions honest', () => {
  const legacy = artifact()
  delete legacy.insights.lockup
  delete legacy.insights.relatedParty
  legacy.sections.offer.routing.truncated = true
  legacy.sections.riskFactors.data.themes = []
  legacy.sections.offer.data.priceRange = null
  render(<ProspectusArtifactView artifact={legacy} />)
  expect(screen.getAllByText('Not available in this analysis.')).toHaveLength(2)
  expect(screen.getByText('No risk themes extracted')).toBeInTheDocument()
  expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  expect(screen.getByText(/The source text was truncated before analysis/)).toBeInTheDocument()
  expect(screen.getByText(/document-wide extraction fallback/)).toBeInTheDocument()
})

it('retains and labels a matched prospectus artifact after a detail refresh fails', async () => {
  const prospectusId = artifact().prospectusId
  let failDetail = false
  const fetchMock = vi.fn(async (input: string) => {
    const path = new URL(input, 'http://test').pathname
    if (path.endsWith('/artifact')) return failDetail
      ? new Response('{}', { status: 503 })
      : Response.json(artifact())
    return Response.json({
      prospectusId,
      companyName: 'Sample Industrial Berhad',
      board: 'MAIN',
      listingDate: '2026-10-08',
      offerPrice: '0.360000',
      headline: artifact().headline,
      asOf: '2026-10-07T02:00:00.000Z',
      source: 'real',
      artifact: { bucket: 'private-artifacts', key: 'identity-only' },
      artifactPath: `/ipo/${prospectusId}/at-a-glance/artifact`,
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  try {
    await renderApp(`/ipo/${prospectusId}`)
    expect((await screen.findAllByText(/Manufactures and supplies industrial components in Malaysia/)).length).toBeGreaterThan(0)
    failDetail = true
    await userEvent.click(screen.getByRole('button', { name: 'Refresh results' }))
    expect(await screen.findByText(/Retained previous analysis — not current/)).toBeInTheDocument()
    expect(screen.getByText(/Retained previous analysis — not current/)).toBeInTheDocument()
    expect(screen.getAllByText(/Manufactures and supplies industrial components in Malaysia/).length).toBeGreaterThan(0)
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/artifact')).length).toBeGreaterThan(1))
  } finally {
    vi.unstubAllGlobals()
  }
})
