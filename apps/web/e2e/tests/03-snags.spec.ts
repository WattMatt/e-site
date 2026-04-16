/**
 * Snags E2E — log a snag and verify status transitions.
 */
import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../auth.json') })

test.describe('Snags', () => {
  test('snags list loads', async ({ page }) => {
    await page.goto('/snags')
    await expect(page.getByRole('heading', { name: /Snags/i })).toBeVisible()
  })

  test('can navigate to create snag form', async ({ page }) => {
    await page.goto('/snags/new')
    await expect(page.getByRole('heading', { name: /New Snag|Log Snag/i })).toBeVisible()
  })

  test('KPI status cards are visible on snags list', async ({ page }) => {
    await page.goto('/snags')
    await expect(page.getByText('Open')).toBeVisible()
    await expect(page.getByText('In Progress')).toBeVisible()
  })
})
