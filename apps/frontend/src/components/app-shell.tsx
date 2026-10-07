import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { SearchBox } from '#/components/search-box'

const NAV = [
  { to: '/', label: 'Market' },
  { to: '/screener', label: 'Screener' },
  { to: '/announcements', label: 'Announcements' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/news', label: 'News' },
] as const

const NAV_LINK =
  'inline-flex h-full items-center border-b-2 border-transparent px-2.5 text-body text-fg-2 transition-colors hover:text-fg'

/** Header (wordmark, primary nav, search) above a single `<main>` landmark. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-1 focus:left-1 focus:z-30 focus:rounded-md focus:bg-surface-2 focus:px-2 focus:py-1"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-10 flex h-11 items-stretch gap-4 border-b border-border bg-surface-1 px-4">
        <Link to="/" className="flex items-center text-sm font-bold tracking-tight text-fg">
          Tuju
        </Link>
        <nav aria-label="Primary" className="flex items-stretch">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === '/' }}
              className={NAV_LINK}
              activeProps={{ className: `${NAV_LINK} border-primary text-fg`, 'aria-current': 'page' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center">
          <SearchBox />
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
    </>
  )
}
