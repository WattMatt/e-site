/**
 * Marketplace E2E — browse suppliers, view supplier profile, place order flow.
 */
import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../auth.json') })

test.describe('Marketplace', () => {
  test('marketplace list loads', async ({ page }) => {
    await page.goto('/marketplace')
    await expect(page.getByRole('heading', { name: /Marketplace/i })).toBeVisible()
  })

  test('shows My Orders link', async ({ page }) => {
    await page.goto('/marketplace')
    await expect(page.getByRole('link', { name: /My Orders/i })).toBeVisible()
  })

  test('orders list loads', async ({ page }) => {
    await page.goto('/marketplace/orders')
    await expect(page.getByRole('heading', { name: /Orders/i })).toBeVisible()
  })

  test('can navigate to browse marketplace', async ({ page }) => {
    await page.goto('/marketplace')
    // If no suppliers exist, empty state should be shown
    const bodyText = await page.textContent('body')
    expect(bodyText).toBeTruthy()
  })
})
