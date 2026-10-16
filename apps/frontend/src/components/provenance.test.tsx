import { render, screen } from '@testing-library/react'
import type { ProvenanceClass } from '@tuju/contracts'
import { ProvenanceBadge, ProvenanceContainer, ProvenanceSource, type ProvenanceKind } from './provenance'

describe('ProvenanceBadge', () => {
  it.each<[ProvenanceKind, string]>([
    ['ai', 'AI-generated'],
    ['synthetic', 'Synthetic data'],
    ['demo-only', 'Demo only'],
  ])('renders visible text for %s', (kind, text) => {
    render(<ProvenanceBadge kind={kind} />)
    expect(screen.getByText(text)).toBeVisible()
    expect(screen.getByText(text)).toHaveAttribute('data-provenance', kind)
  })

  it('AI is solid violet; synthetic and demo-only are dashed cyan', () => {
    render(
      <>
        <ProvenanceBadge kind="ai" />
        <ProvenanceBadge kind="synthetic" />
        <ProvenanceBadge kind="demo-only" />
      </>,
    )
    const ai = screen.getByText('AI-generated')
    expect(ai).toHaveClass('border-solid', 'text-ai')
    expect(ai).not.toHaveClass('border-dashed')
    for (const text of ['Synthetic data', 'Demo only']) {
      expect(screen.getByText(text)).toHaveClass('border-dashed', 'text-synthetic')
    }
  })

  it('accepts a label override but still shows text', () => {
    render(<ProvenanceBadge kind="ai" label="AI summary" />)
    expect(screen.getByText('AI summary')).toBeVisible()
  })

  it('marks the AI sparkle as decorative', () => {
    render(<ProvenanceBadge kind="ai" />)
    expect(screen.getByText('✦')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('ProvenanceContainer', () => {
  it('wraps content with a badge and names the group by it', () => {
    render(
      <ProvenanceContainer kind="synthetic" caption="Not live market data">
        <p>Prices are generated.</p>
      </ProvenanceContainer>,
    )
    const group = screen.getByRole('group', { name: 'Synthetic data' })
    expect(group).toHaveTextContent('Prices are generated.')
    expect(group).toHaveTextContent('Not live market data')
    expect(group).toHaveClass('border-dashed')
    expect(group).toHaveAttribute('data-provenance-container', 'synthetic')
  })

  it('uses a solid border for AI content', () => {
    render(
      <ProvenanceContainer kind="ai" label="AI summary">
        <p>Summary text.</p>
      </ProvenanceContainer>,
    )
    const group = screen.getByRole('group', { name: 'AI summary' })
    expect(group).toHaveClass('border-solid')
    expect(group).not.toHaveClass('border-dashed')
  })

  it('gives each container its own label id', () => {
    render(
      <>
        <ProvenanceContainer kind="ai">a</ProvenanceContainer>
        <ProvenanceContainer kind="demo-only">b</ProvenanceContainer>
      </>,
    )
    expect(screen.getByRole('group', { name: 'AI-generated' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Demo only' })).toBeInTheDocument()
  })
})

// Production `apiGet` skips response validation, so anything the backend sends
// arrives typed as ProvenanceClass whatever it actually is.
const received = (value: unknown) => value as ProvenanceClass

describe('ProvenanceSource', () => {
  it('badges synthetic data', () => {
    render(<ProvenanceSource value="synthetic" />)
    expect(screen.getByText('Synthetic data')).toHaveAttribute('data-provenance', 'synthetic')
  })

  it('qualifies a real source as not a live quote', () => {
    render(<ProvenanceSource value="real" />)
    expect(screen.getByText('Real source · not a live quote guarantee')).toBeVisible()
  })

  it('marks an aggregator source as private demo and non-redistributable', () => {
    render(<ProvenanceSource value="aggregator" />)
    expect(screen.getByText('Aggregator · private demo / non-redistributable')).toBeVisible()
  })

  it.each([
    ['unknown', 'vendor-daily'],
    ['absent', undefined],
    ['null', null],
  ])('never presents an %s provenance class as a real source', (_case, value) => {
    render(<ProvenanceSource value={received(value)} />)
    expect(screen.getByText('Source unavailable')).toBeVisible()
    expect(screen.queryByText(/Real source/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Aggregator/)).not.toBeInTheDocument()
  })
})
