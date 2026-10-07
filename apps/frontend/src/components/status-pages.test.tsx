import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorPage } from './status-pages'

const invalidate = vi.fn()
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate }),
}))

describe('ErrorPage', () => {
  it('announces the failure and retries by invalidating the router', async () => {
    render(<ErrorPage error={new Error('boom')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('This page failed to load')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(invalidate).toHaveBeenCalledTimes(1)
  })
})
