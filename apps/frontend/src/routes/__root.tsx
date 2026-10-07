import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'

import type { RouterContext } from '../router'

import appCss from '../styles.css?url'

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Tuju — Bursa Malaysia Intelligence' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children ?? <Outlet />}
        <Scripts />
      </body>
    </html>
  )
}
