import { render, screen } from '@testing-library/react'
import { ChangeChip, changeDirection } from './change-chip'

describe('ChangeChip', () => {
  it('shows an up arrow and a plus sign for gains', () => {
    const { container } = render(<ChangeChip value={1.24} />)
    const chip = container.firstElementChild!
    expect(chip).toHaveTextContent('▲')
    expect(chip).toHaveTextContent('+1.24%')
    expect(chip).toHaveAttribute('data-direction', 'up')
    expect(chip).toHaveClass('text-up', 'bg-up-bg')
  })

  it('shows a down arrow and a minus sign for losses', () => {
    const { container } = render(<ChangeChip value={-0.87} />)
    const chip = container.firstElementChild!
    expect(chip).toHaveTextContent('▼')
    expect(chip).toHaveTextContent('-0.87%')
    expect(chip).toHaveAttribute('data-direction', 'down')
    expect(chip).toHaveClass('text-down', 'bg-down-bg')
  })

  it('shows a flat marker and no sign when unchanged', () => {
    const { container } = render(<ChangeChip value={0} />)
    const chip = container.firstElementChild!
    expect(chip).toHaveTextContent('▬')
    expect(chip).toHaveTextContent('0.00%')
    expect(chip.textContent).not.toMatch(/[+-]/)
    expect(chip).toHaveAttribute('data-direction', 'unch')
    expect(chip).toHaveClass('text-unch', 'bg-unch-bg')
  })

  it('treats a value that rounds to zero as unchanged, with no sign', () => {
    const { container } = render(<ChangeChip value={-0.004} />)
    expect(container.firstElementChild).toHaveAttribute('data-direction', 'unch')
    expect(container.textContent).not.toContain('-')
  })

  it('exposes direction in words for screen readers; arrow is decorative', () => {
    render(<ChangeChip value={1.24} />)
    expect(screen.getByText('Up')).toHaveClass('sr-only')
    expect(screen.getByText('▲')).toHaveAttribute('aria-hidden', 'true')
  })

  it('supports plain signed numbers for index points', () => {
    const { container } = render(<ChangeChip value={-12.5} unit="none" />)
    expect(container.firstElementChild).toHaveTextContent('▼')
    expect(container.firstElementChild).toHaveTextContent('-12.50')
    expect(container.textContent).not.toContain('%')
  })

  it('uses mono tabular numerals', () => {
    const { container } = render(<ChangeChip value={1} />)
    expect(container.firstElementChild).toHaveClass('num')
  })

  it.each([null, undefined, Number.NaN])('renders a labelled placeholder for %s', (value) => {
    const { container } = render(<ChangeChip value={value} />)
    expect(container.firstElementChild).toHaveAttribute('data-direction', 'none')
    expect(container.firstElementChild).toHaveTextContent('No change data')
    expect(container.textContent).not.toMatch(/[▲▼]/)
  })
})

describe('changeDirection', () => {
  it('respects displayed precision', () => {
    expect(changeDirection(0.004, 2)).toBe('unch')
    expect(changeDirection(0.005, 2)).toBe('up')
    expect(changeDirection(-0.006, 2)).toBe('down')
    expect(changeDirection(0.004, 3)).toBe('up')
  })
})
