/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * TanStack Start 1.x — static SPA build (ADR-0005).
 *
 * `spa.enabled: true` makes the production build prerender only the root-route
 * shell to a static `_shell.html`, so the whole app ships as static assets on a
 * CDN with no FE server on the request path. SSR capability stays in the box
 * (Start is SSR-capable) but is deliberately unused for Product A v1; turning it
 * on later is an additive change, not a rewrite.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tanstackStart({
      spa: {
        enabled: true,
      },
    }),
    viteReact(),
    tailwindcss(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Route tree is generated; unit tests target plain modules/components.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
