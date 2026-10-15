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
  // A client-side navigation proves hydration finished before sending a raw
  // keyboard event (unlike locator actions, keyboard.press has no auto-wait).
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Screener' }).click()
  await expect(page).toHaveURL('/screener')
  await page.keyboard.press('/')
  const input = page.getByRole('combobox', { name: 'Search stocks' })
  await expect(input).toBeFocused()
  await input.fill('no-such-stock')
  await expect(page.getByRole('status')).toHaveText('No matches')
  await input.fill('may')
  await expect(page.getByRole('option', { name: /MAYBANK/ })).toBeVisible()
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(page).toHaveURL('/stocks/1155')
})

test('primary navigation and direct nested URLs load', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Primary' })
  for (const [label, path] of [['Screener', '/screener'], ['Announcements', '/announcements'], ['Calendar', '/calendar'], ['News', '/news']] as const) {
    await nav.getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL(path)
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
  }
  await page.goto('/ipo/smoke-prospectus')
  await expect(page.getByRole('heading', { name: 'Prospectus at a glance' })).toBeVisible()
})
