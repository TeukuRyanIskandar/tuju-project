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
  'inline-flex h-full shrink-0 items-center whitespace-nowrap border-b-2 border-transparent px-2.5 text-body text-fg-2 transition-colors hover:text-fg focus-visible:-outline-offset-2!'

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
      <header className="sticky top-0 z-10 flex flex-wrap items-stretch gap-x-4 border-b border-border bg-surface-1 px-4 md:h-11 md:flex-nowrap">
        <Link to="/" className="flex h-11 shrink-0 items-center text-sm font-bold tracking-tight text-fg md:h-auto">
          Tuju
        </Link>
        <nav aria-label="Primary" className="order-last flex h-10 w-full min-w-0 items-stretch overflow-x-auto md:order-none md:h-auto md:w-auto">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === '/' }}
              onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
              className={NAV_LINK}
              activeProps={{ className: `${NAV_LINK} border-primary text-fg`, 'aria-current': 'page' }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 flex-1 items-center md:w-64 md:flex-none">
          <SearchBox />
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
    </>
  )
}
