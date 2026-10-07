import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiUrl } from '#/lib/api'
import { renderApp } from '#/test/render-app'

const ROWS = [
  { stockCode: '1155', shortName: 'MAYBANK', fullName: 'MALAYAN BANKING BHD', companyName: 'Malayan Banking Berhad', board: 'MAIN', sectorName: 'Financial Services' },
  { stockCode: '1023', shortName: 'CIMB', fullName: 'CIMB GROUP HOLDINGS BHD', companyName: 'CIMB Group Holdings Berhad', board: 'MAIN', sectorName: 'Financial Services' },
  { stockCode: '5347', shortName: 'TENAGA', fullName: 'TENAGA NASIONAL BHD', companyName: 'Tenaga Nasional Berhad', board: 'MAIN', sectorName: 'Utilities' },
]

let fetchMock: ReturnType<typeof vi.fn>

function respondWithMatches() {
  fetchMock.mockImplementation(async (url: string) => {
    const q = new URL(url, 'http://x').searchParams.get('q') ?? ''
    return new Response(JSON.stringify({ query: q, items: q ? ROWS : [] }), { status: 200 })
  })
}

const searchCalls = () => fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.includes('/search'))

// Real timers: Testing Library's async wrapper waits on a real setTimeout, which
// never fires under vitest fake timers. The debounce is short enough to wait out.
const settled = () => screen.findAllByRole('option', undefined, { timeout: 2000 })

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  respondWithMatches()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function mount() {
  const app = await renderApp('/screener')
  return { ...app, user: userEvent.setup({ delay: null }), input: screen.getByRole('combobox', { name: 'Search stocks' }) }
}

describe('SearchBox debounce', () => {
  it('sends no request until the debounce elapses, then exactly one', async () => {
    const { user, input } = await mount()
    await user.click(input)
    await user.type(input, 'mayb')
    // Typed in one burst: nothing sent yet.
    expect(searchCalls()).toHaveLength(0)

    await waitFor(() => expect(searchCalls()).toHaveLength(1))
    await settled()
    expect(searchCalls()).toEqual([apiUrl('/search?q=mayb&limit=8')])
  })

  it('shows results as listbox options', async () => {
    const { user, input } = await mount()
    await user.type(input, 'b')
    expect(await settled()).toHaveLength(3)
    expect(input).toHaveAttribute('aria-expanded', 'true')
  })

  it('says so when nothing matches', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ query: 'zzz', items: [] })))
    const { user, input } = await mount()
    await user.type(input, 'zzz')
    expect(await screen.findByText('No matches')).toBeInTheDocument()
  })
})

describe('SearchBox keyboard', () => {
  it('"/" focuses the search, but not while typing in another field', async () => {
    const { user, input } = await mount()
    expect(input).not.toHaveFocus()
    await user.keyboard('/')
    expect(input).toHaveFocus()
    expect(input).toHaveValue('')

    const other = document.createElement('input')
    document.body.append(other)
    other.focus()
    await user.keyboard('/')
    expect(other).toHaveFocus()
    expect(other).toHaveValue('/')
    other.remove()
  })

  it('ArrowDown/ArrowUp move the active option and wrap', async () => {
    const { user, input } = await mount()
    await user.type(input, 'b')
    await settled()
    const options = screen.getAllByRole('option')

    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[2]!.id)

    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id)

    await user.keyboard('{ArrowUp}')
    expect(input).toHaveAttribute('aria-activedescendant', options[2]!.id)
  })

  it('Escape closes the list, then clears the text', async () => {
    const { user, input } = await mount()
    await user.type(input, 'b')
    await settled()
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveValue('b')
    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })

  it('Enter on the highlighted option navigates to its stock page', async () => {
    const { user, input, router } = await mount()
    await user.type(input, 'b')
    await settled()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(router.state.location.pathname).toBe('/stocks/1023')
    expect(await screen.findByRole('heading', { name: 'Stock 1023' })).toBeInTheDocument()
  })

  it('Enter with nothing highlighted opens the first result', async () => {
    const { user, input, router } = await mount()
    await user.type(input, '1155')
    await settled()
    await user.keyboard('{Enter}')
    expect(router.state.location.pathname).toBe('/stocks/1155')
  })

  it('Enter before the results arrive does not navigate', async () => {
    const { user, input, router } = await mount()
    await user.type(input, '1155')
    await user.keyboard('{Enter}')
    expect(router.state.location.pathname).toBe('/screener')
    expect(searchCalls()).toHaveLength(0)
  })

  it('clicking an option navigates', async () => {
    const { user, input, router } = await mount()
    await user.type(input, 'b')
    await settled()
    await user.click(screen.getAllByRole('option')[2]!)
    await waitFor(() => expect(router.state.location.pathname).toBe('/stocks/5347'))
  })
})
