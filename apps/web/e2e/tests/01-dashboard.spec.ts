/**
 * Dashboard E2E — verifies the dashboard loads with role-appropriate data.
 */
import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../auth.json') })

test.describe('Dashboard', () => {
  test('loads dashboard page', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/dashboard/)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('shows KPI cards', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByText('Active Projects')).toBeVisible()
    await expect(page.getByText('Open Snags')).toBeVisible()
    await expect(page.getByText('Pending COCs')).toBeVisible()
  })

  test('notification bell is visible', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.locator('button[title="Notifications"]')).toBeVisible()
  })

  test('quick action links are present', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('link', { name: /New Project/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Log Snag/i })).toBeVisible()
  })
})
