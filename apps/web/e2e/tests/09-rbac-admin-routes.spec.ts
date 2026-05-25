/**
 * RBAC — PR2 + PR3 invariants for admin-only routes.
 *
 * Verifies that a `contractor`-role user:
 *   1. cannot POST /api/paystack/checkout (returns 403)
 *   2. is redirected away from /settings/billing
 *   3. is redirected away from /settings/users
 *   4. does not see the Settings link in the sidebar
 *
 * Self-contained — no shared auth.setup fixture. Each test logs in inline so
 * the spec only runs when the contractor demo user has been seeded. Set
 * `E2E_CONTRACTOR_EMAIL` (and optionally `E2E_CONTRACTOR_PASSWORD`) to enable;
 * unset, every test in this file is skipped without affecting the rest of
 * the e2e run.
 *
 * Suggested seed (in your dev DB):
 *   - Email:     demo.contractor@wmeng.co.za
 *   - Password:  Demo@esite2025!
 *   - Role:      contractor on the WM-Consulting org
 */
import { test, expect } from '@playwright/test'

const CONTRACTOR_EMAIL = process.env.E2E_CONTRACTOR_EMAIL
const CONTRACTOR_PASS  = process.env.E2E_CONTRACTOR_PASSWORD ?? 'Demo@esite2025!'
const SKIP_REASON = 'E2E_CONTRACTOR_EMAIL not set — seed a contractor demo user to enable PR2/PR3 RBAC tests'

test.describe('RBAC: admin-only surfaces deny contractor role', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!CONTRACTOR_EMAIL, SKIP_REASON)

    await page.goto('/login')
    await page.getByLabel('Email').fill(CONTRACTOR_EMAIL!)
    await page.getByLabel('Password').fill(CONTRACTOR_PASS)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await page.waitForURL('**/dashboard', { timeout: 15_000 })
  })

  test('POST /api/paystack/checkout returns 403 for contractor', async ({ page, request }) => {
    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    const res = await request.post('/api/paystack/checkout', {
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      data: { tier: 'starter', period: 'monthly' },
      failOnStatusCode: false,
    })

    expect(res.status()).toBe(403)
  })

  test('GET /settings/billing redirects contractor away', async ({ page }) => {
    await page.goto('/settings/billing')
    // requireRolePage redirects to /dashboard; assert we left the billing route
    await expect(page).not.toHaveURL(/\/settings\/billing/)
  })

  test('GET /settings/users redirects contractor away', async ({ page }) => {
    await page.goto('/settings/users')
    await expect(page).not.toHaveURL(/\/settings\/users/)
  })

  test('sidebar omits the Settings link for contractor', async ({ page }) => {
    await page.goto('/dashboard')
    // Scope to the sidebar so we don't match incidental Settings text elsewhere
    const sidebar = page.locator('aside').first()
    const settingsLink = sidebar.getByRole('link', { name: 'Settings', exact: true })
    await expect(settingsLink).not.toBeVisible()
  })
})
