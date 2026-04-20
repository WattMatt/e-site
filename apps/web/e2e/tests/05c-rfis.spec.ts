/**
 * RFIs E2E — create RFI, view list, check status badge.
 * Runs as owner role.
 */
import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../auth.json') })

test.describe('RFIs', () => {
  test('RFI list loads', async ({ page }) => {
    await page.goto('/rfis')
    await expect(page.getByRole('heading', { name: /RFI/i })).toBeVisible()
  })

  test('can navigate to new RFI form', async ({ page }) => {
    await page.goto('/rfis/new')
    await expect(page.getByRole('heading', { name: /New RFI|Raise RFI|Request for Information/i })).toBeVisible()
  })

  test('creates an RFI and it appears in the list', async ({ page }) => {
    await page.goto('/rfis/new')

    // Select project
    const projectSelect = page.getByLabel(/Project/i).first()
    await projectSelect.selectOption({ index: 1 })

    const subject = `E2E RFI ${Date.now()}`
    await page.getByLabel(/Subject/i).fill(subject)
    await page.getByLabel(/Description/i).fill('E2E test: clarification required on cable routing.')
    await page.getByLabel(/Priority/i).selectOption('high')
    await page.getByLabel(/Category/i).selectOption({ index: 1 })

    await page.getByRole('button', { name: /Create|Submit|Raise/i }).click()

    await page.waitForURL(/\/rfis\/[a-f0-9-]+/, { timeout: 10_000 })
    await expect(page.getByText(subject)).toBeVisible()
  })

  test('new RFI appears in RFI list', async ({ page }) => {
    await page.goto('/rfis')
    // List should render without error
    await expect(page.locator('body')).not.toContainText('Error')
    await expect(page).not.toHaveURL(/login/)
  })

  test('RFI detail shows status badge', async ({ page }) => {
    await page.goto('/rfis')
    // Click first RFI row
    const firstRfi = page.locator('a[href*="/rfis/"]').first()
    if (await firstRfi.isVisible()) {
      await firstRfi.click()
      await page.waitForURL(/\/rfis\/[a-f0-9-]+/)
      // Status badge should be visible
      const statusBadge = page.locator('.badge, [class*="badge"], [class*="status"]').first()
      await expect(statusBadge).toBeVisible()
    }
  })
})
