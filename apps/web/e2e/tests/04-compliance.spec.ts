/**
 * Compliance E2E — compliance sites list, add site, upload COC flow.
 */
import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../auth.json') })

test.describe('Compliance', () => {
  test('compliance list loads', async ({ page }) => {
    await page.goto('/compliance')
    await expect(page.getByRole('heading', { name: /Compliance/i })).toBeVisible()
  })

  test('can navigate to add new site', async ({ page }) => {
    await page.goto('/compliance/new')
    await expect(page.getByRole('heading', { name: /New Site|Add Site/i })).toBeVisible()
  })

  test('creates a new compliance site', async ({ page }) => {
    await page.goto('/compliance/new')
    const siteName = `E2E Site ${Date.now()}`

    await page.getByLabel(/Site name/i).fill(siteName)
    await page.getByLabel(/Address/i).fill('5 Compliance Ave')
    await page.getByLabel(/City/i).fill('Cape Town')

    await page.getByRole('button', { name: /Create|Add Site/i }).click()

    await page.waitForURL(/\/compliance\/[a-f0-9-]+/, { timeout: 10_000 })
    await expect(page.getByText(siteName)).toBeVisible()
  })
})
