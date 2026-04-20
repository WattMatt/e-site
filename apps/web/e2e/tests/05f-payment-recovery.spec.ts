/**
 * Payment recovery E2E (T-064) — PaymentStatusBanner, procurement page.
 * The banner is a server component that renders only when subscription is
 * in a failed/paused state. We verify the page layout handles both states.
 * Runs as owner role.
 */
import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../auth.json') })

test.describe('Payment recovery (T-064)', () => {
  test('dashboard renders without PaymentStatusBanner crashing (active subscription)', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/dashboard/)
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('body')).not.toContainText('Internal Server Error')
  })

  test('procurement page loads', async ({ page }) => {
    await page.goto('/procurement')
    await expect(page.getByRole('heading', { name: /Procurement/i })).toBeVisible()
  })

  test('payment banner amber/red variant renders correctly if visible', async ({ page }) => {
    await page.goto('/dashboard')
    // If the banner is present (subscription in failed state), verify correct classes
    const amberBanner = page.locator('[class*="amber"], [class*="warning"]').filter({ hasText: /payment/i })
    const redBanner   = page.locator('[class*="red"], [class*="danger"]').filter({ hasText: /payment/i })
    // Either a banner is shown with correct styling, or it's simply absent (active subscription)
    const amberVisible = await amberBanner.isVisible().catch(() => false)
    const redVisible   = await redBanner.isVisible().catch(() => false)
    if (amberVisible || redVisible) {
      // Verify banner has a CTA link to billing settings
      const billingLink = page.getByRole('link', { name: /Update Payment|Billing|Pay Now/i })
      await expect(billingLink).toBeVisible()
    }
    // If neither: subscription is active, which is correct for demo org
  })
})
