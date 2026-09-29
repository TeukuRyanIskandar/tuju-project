import { createFileRoute, useLoaderData } from '@tanstack/react-router'
import { API_BASE_URL } from '../lib/api'
import { checkBackendHealth, type HealthStatus } from '../lib/health'

/**
 * Placeholder route — the ticket-04 end-to-end wiring proof.
 *
 * The loader calls the backend `/health` endpoint (ADR-0010) through the
 * env-configurable API base (ADR-0005). Because SPA mode prerenders only the
 * root shell, this loader runs on the client at navigation time — exactly the
 * static-SPA-talks-to-backend shape Product A ships.
 */
export const Route = createFileRoute('/')({
  loader: async (): Promise<HealthStatus> => checkBackendHealth(),
  component: Home,
})

function Home() {
  const health = useLoaderData({ from: '/' })

  return (
    <main>
      <h1>Tuju — Bursa Malaysia Intelligence</h1>
      <p>Frontend skeleton (TanStack Start, static SPA). Wiring proof below.</p>

      <section>
        <h2>Backend /health</h2>
        <p>
          API base: <code>{API_BASE_URL || '(same-origin)'}</code>
        </p>
        <p data-testid="health-status">
          {health.ok ? '✅ reachable' : '❌ unreachable'} — <code>{health.detail}</code>
        </p>
      </section>
    </main>
  )
}
