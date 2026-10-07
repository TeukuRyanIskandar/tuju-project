import { fireEvent, render, screen } from '@testing-library/react'
import { Kbd } from './kbd'
import { Panel } from './panel'
import { EmptyState, ErrorState, LoadingState } from './states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSymbol } from './table'

describe('Panel', () => {
  it('is a region named by its title heading', () => {
    render(
      <Panel title="Top movers" meta="5 of 30">
        body
      </Panel>,
    )
    expect(screen.getByRole('region', { name: 'Top movers' })).toHaveTextContent('body')
    expect(screen.getByRole('heading', { level: 2, name: 'Top movers' })).toBeInTheDocument()
    expect(screen.getByText('5 of 30')).toBeInTheDocument()
  })

  it('supports a different heading level', () => {
    render(
      <Panel title="Nested" headingLevel={3}>
        x
      </Panel>,
    )
    expect(screen.getByRole('heading', { level: 3, name: 'Nested' })).toBeInTheDocument()
  })
})

describe('Kbd', () => {
  it('renders a kbd element', () => {
    render(<Kbd>/</Kbd>)
    expect(screen.getByText('/').tagName).toBe('KBD')
  })
})

describe('LoadingState', () => {
  it('announces a status with visible text', () => {
    render(<LoadingState label="Loading movers…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading movers…')
  })
})

describe('EmptyState', () => {
  it('shows title, description and action without an alert role', () => {
    render(<EmptyState title="No results" description="Try a wider filter." action={<button>Reset</button>} />)
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.getByText('Try a wider filter.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ErrorState', () => {
  it('is an alert with a label, a message and a decorative icon', () => {
    render(<ErrorState message="Could not load quotes." />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong')
    expect(alert).toHaveTextContent('Could not load quotes.')
    expect(screen.getByText('×')).toHaveAttribute('aria-hidden', 'true')
  })

  it('uses danger, never the market down colour', () => {
    render(<ErrorState />)
    expect(screen.getByRole('alert').className).toContain('border-l-danger')
    expect(screen.getByRole('alert').className).not.toContain('down')
  })

  it('only offers retry when a handler is given, and calls it', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<ErrorState />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<ErrorState onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('Table', () => {
  function sample(selected = false) {
    return (
      <Table aria-label="Top movers">
        <TableHeader>
          <tr>
            <TableHead>Symbol</TableHead>
            <TableHead numeric>Last</TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          <TableRow selected={selected}>
            <TableCell>
              <TableSymbol code="TENAGA" name="Tenaga Nasional" />
            </TableCell>
            <TableCell numeric>14.880</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
  }

  it('renders column headers with scope and a named, focusable scroll region', () => {
    render(sample())
    expect(screen.getByRole('columnheader', { name: 'Symbol' })).toHaveAttribute('scope', 'col')
    expect(screen.getByRole('table', { name: 'Top movers' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Top movers' })).toHaveAttribute('tabindex', '0')
  })

  it('right-aligns numeric cells in mono', () => {
    render(sample())
    expect(screen.getByText('14.880')).toHaveClass('num', 'text-right')
    expect(screen.getByRole('columnheader', { name: 'Last' })).toHaveClass('text-right')
  })

  it('shows symbol and company name', () => {
    render(sample())
    expect(screen.getByText('TENAGA')).toHaveClass('font-mono', 'font-semibold')
    expect(screen.getByText('Tenaga Nasional')).toHaveClass('text-fg-3')
  })

  it('marks the selected row with aria-current, not colour alone', () => {
    const { rerender } = render(sample(false))
    expect(screen.getAllByRole('row')[1]).not.toHaveAttribute('aria-current')
    rerender(sample(true))
    expect(screen.getAllByRole('row')[1]).toHaveAttribute('aria-current', 'true')
  })

  it('leaves an unlabelled table without a region wrapper', () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})
