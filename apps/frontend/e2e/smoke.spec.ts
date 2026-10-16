import { expect, test } from '@playwright/test'

// Deliberately mocked API: these tests exercise the built UI in Chromium,
// not the real backend, data ingestion, or browser CORS/session integration.
test.beforeEach(async ({ page }) => {
  await page.route('**/search?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? ''
    await route.fulfill({
      json: {
        query,
        items: query.toLowerCase().includes('may') ? [{
          stockCode: '1155', shortName: 'MAYBANK', fullName: 'MALAYAN BANKING BHD',
          companyName: 'Malayan Banking Berhad', board: 'MAIN', sectorName: 'Financial Services',
        }] : [],
      },
    })
  })
})

test('search input and mouse selection navigate to a stock; refresh preserves the route', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Search stocks' }).fill('maybank')
  await page.getByRole('option', { name: /MAYBANK/ }).click()
  await expect(page).toHaveURL('/stocks/1155')
  await expect(page.getByRole('heading', { name: 'Stock 1155', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Stock 1155', exact: true })).toBeVisible()
})

test('search supports keyboard selection and empty results', async ({ page }) => {
  await page.goto('/')
  const input = page.getByRole('combobox', { name: 'Search stocks' })
  // Locator-driven typing waits for hydration and exercises the real React
  // keyboard handlers without depending on a primary-nav link.
  await input.fill('no-such-stock')
  await expect(input).toBeFocused()
  await expect(page.getByRole('status').filter({ hasText: 'No matches' })).toHaveText('No matches')
  await input.fill('may')
  await expect(page.getByRole('option', { name: /MAYBANK/ })).toBeVisible()
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(page).toHaveURL('/stocks/1155')
})

test('primary navigation and direct nested URLs load', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav.getByRole('link')).toHaveCount(1)
  await expect(nav.getByRole('link', { name: 'Market', exact: true })).toHaveAttribute('href', '/')
  for (const [label, path] of [['Screener', '/screener'], ['Announcements', '/announcements'], ['Calendar', '/calendar'], ['News', '/news']] as const) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0)
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: label, exact: true })).toBeVisible()
  }
})

test('direct prospectus URL renders its page heading', async ({ page }) => {
  await page.goto('/ipo/smoke-prospectus')
  await expect(page.getByRole('heading', { level: 1, name: 'Prospectus at a glance' })).toBeVisible()
})
