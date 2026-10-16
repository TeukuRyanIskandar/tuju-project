import { expect, test } from '@playwright/test'
import technical from '../../../packages/contracts/fixtures/technical-analysis-artifact.json' with { type: 'json' }
import fundamental from '../../../packages/contracts/fixtures/fundamental-analysis-artifact.json' with { type: 'json' }

// Mock transport only: built SPA/Chromium, not backend freshness, CORS or ingestion.
test('direct stock history is keyboard accessible, local-filtered and narrow-screen safe', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  let seriesReads = 0
  await page.route('**/stocks/1155/analysis/**', route => route.fulfill({ status: 404, json: {} }))
  await page.route('**/stocks/1155', route => route.request().resourceType() === 'document' ? route.continue() : route.fulfill({ json: {
    identity: { stockCode: '1155', shortName: 'MAYBANK', fullName: 'MALAYAN BANKING BHD', companyName: 'Malayan Banking Berhad', board: 'MAIN', sector: 'Financial Services', provenance: 'real' },
    fundamentals: null, technicals: null, shariah: { provenance: 'real', status: null, effectiveDate: null },
  } }))
  await page.route('**/stocks/1155/series?*', route => {
    seriesReads++
    return route.fulfill({ json: { code: '1155', interval: '1d', range: '2y', provenance: 'real', demoLabel: 'private-demo', points: [
      { date: '2025-01-01', open: '8', high: '8', low: '8', close: '8', volume: '10' },
      { date: '2026-10-01', open: '10', high: '10', low: '10', close: '10', volume: '0' },
      { date: '2026-10-02', open: '11', high: '11', low: '11', close: '11', volume: '20' },
    ] } })
  })
  await page.goto('/stocks/1155')
  await expect(page.getByRole('heading', { name: '1155 · MAYBANK' })).toBeVisible()
  await expect(page.getByRole('img', { name: /Daily EOD close/ })).toBeVisible()
  const slider = page.getByRole('slider', { name: 'Inspect trading day' })
  await slider.focus()
  await slider.press('Home')
  await expect(slider).toHaveAttribute('aria-valuetext', '1 Oct 2026; close RM 10.000; volume 0')
  await slider.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuetext', '2 Oct 2026; close RM 11.000; volume 20')
  await page.getByRole('button', { name: '2Y', exact: true }).click()
  const summary = page.getByText('Inspect daily data table')
  await summary.focus()
  await summary.press('Enter')
  await expect(page.getByRole('table')).toContainText('1 Jan 2025')
  for (const range of ['1M', '3M', '1Y']) await page.getByRole('button', { name: range, exact: true }).click()
  expect(seriesReads).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: '1155 · MAYBANK' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to market' }).click()
  await expect(page).toHaveURL('/')
})

test('core and chart failures stay independent in the built SPA', async ({ page }) => {
  await page.route('**/stocks/1155/analysis/**', route => route.fulfill({ status: 404, json: {} }))
  await page.route('**/stocks/1155', route => route.request().resourceType() === 'document' ? route.continue() : route.fulfill({ status: 404, json: {} }))
  await page.route('**/stocks/1155/series?*', route => route.fulfill({ json: {
    code: '1155', interval: '1d', range: '2y', provenance: 'synthetic', demoLabel: 'private-demo', points: [],
  } }))
  await page.goto('/stocks/1155')
  await expect(page.getByRole('region', { name: 'Stock identity' }).getByRole('alert')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Daily EOD history' })).toContainText('No daily history available')
  await expect(page.getByRole('region', { name: 'Daily EOD history' })).toContainText('Synthetic data')
  await expect(page.getByRole('region', { name: 'Stock news' })).toContainText('Reserved')
})

test('analysis facts, independent errors and read-only keyboard refresh fit a 390px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const methods: string[] = []
  let taArtifactReads = 0
  let mismatch = false
  let failSummary = false
  let malformed = false
  await page.route('**/stocks/1155', route => route.request().resourceType() === 'document' ? route.continue() : route.fulfill({ status: 404, json: {} }))
  await page.route('**/stocks/1155/series?*', route => route.fulfill({ status: 404, json: {} }))
  await page.route('**/stocks/1155/analysis/**', route => {
    methods.push(route.request().method())
    const ta = route.request().url().includes('/technical')
    const artifact = ta ? technical : fundamental
    if (route.request().url().endsWith('/artifact')) {
      const { cost: _cost, ...body } = artifact
      if (ta) taArtifactReads++
      return route.fulfill({ json: { ...body, ...(ta && mismatch ? { symbol: '1023' } : {}), ...(!ta && malformed ? { metrics: null } : {}), narrative: ta ? { language: 'en', text: 'Narrative withheld: failed the grounding check.' } : body.narrative } })
    }
    if (ta && failSummary) return route.fulfill({ status: 404, json: { errorMessage: 'private stack costUsd' } })
    return route.fulfill({ json: {
      code: '1155', jobName: artifact.jobName, status: ta ? 'stale' : 'ready', headline: ta ? 'facts-only: Grounding check failed.' : 'Stored fundamental summary',
      asOf: new Date(artifact.asOf).toISOString(), artifact: { bucket: 'private', key: 'private-key' }, artifactPath: '/private-pointer', errorMessage: null,
    } })
  })
  await page.goto('/stocks/1155')
  const ta = page.getByRole('region', { name: 'Technical analysis', exact: true })
  const fa = page.getByRole('region', { name: 'Fundamental analysis', exact: true })
  await expect(ta.getByText('AI explanation unavailable. Computed facts remain available.')).toBeVisible()
  await expect(fa.getByText('5.67%', { exact: true })).toBeVisible()
  await expect(ta).toContainText('Stale')
  await expect(ta).toContainText('Not fired')
  await expect(ta).not.toContainText('Narrative withheld')
  await expect(page.getByRole('region', { name: 'Daily EOD history' }).getByRole('alert')).toBeVisible()
  const refresh = ta.getByRole('button', { name: 'Refresh technical analysis' })
  mismatch = true
  await refresh.focus()
  await expect(refresh).toBeFocused()
  await refresh.press('Enter')
  await expect(ta.getByRole('alert')).toContainText('does not match')
  expect(taArtifactReads).toBe(3) // initial matched read + exactly two mismatch reads
  await expect(ta.getByRole('region', { name: 'Retained analysis result' })).toContainText('not current')
  await expect(fa.getByText('5.67%', { exact: true })).toBeVisible()
  failSummary = true
  await refresh.press('Enter')
  await expect(ta.getByRole('alert')).toContainText('not available')
  expect(taArtifactReads).toBe(3)
  expect(methods.every(method => method === 'GET')).toBe(true)
  await expect(page.locator('body')).not.toContainText('private-key')
  await expect(page.locator('body')).not.toContainText('private stack costUsd')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await refresh.press('Tab')
  await expect(fa.getByRole('button', { name: 'Refresh fundamental analysis' })).toBeFocused()
  malformed = true
  await fa.getByRole('button', { name: 'Refresh fundamental analysis' }).press('Enter')
  await expect(fa.getByRole('alert')).toContainText('Analysis detail unavailable')
  await expect(fa.getByRole('region', { name: 'Retained analysis result' })).toContainText('5.67%')
  await fa.getByRole('button', { name: 'Refresh fundamental analysis' }).press('Enter')
  await expect(fa.getByRole('alert')).toContainText('Analysis detail unavailable')
  await expect(fa.getByRole('region', { name: 'Retained analysis result' })).toContainText('5.67%')
  await expect(ta.getByRole('region', { name: 'Retained analysis result' })).toBeVisible()
})
