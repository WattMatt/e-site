/**
 * Legal / compliance pages E2E (T-065) — public routes render without auth.
 *
 * ⚠ This file used to claim in its header that it "runs without storageState
 * (unauthenticated) since legal pages are public" — and it did not. Its name
 * matches playwright.config's `chromium-owner` project (`/0[1-6].*\.spec\.ts/`),
 * which supplies `storageState: 'e2e/auth.json'`, so every one of these pages
 * was fetched with a signed-in session. `expect(page).not.toHaveURL(/login/)`
 * on /unsubscribe therefore PASSED while anonymous visitors — which is every
 * recipient clicking an unsubscribe link from their inbox — were 307'd to
 * /login in production for the entire life of the lifecycle-email programme.
 *
 * The assertion was not wrong. The fixture could not express the property:
 * a signed-in browser cannot detect a gate that only fires when there is no
 * session. `test.use({ storageState: ... })` below overrides the project's
 * auth state file-wide and is what makes these tests capable of failing.
 */
import { test, expect } from '@playwright/test'

// Anonymous, regardless of which project runs this file.
test.use({ storageState: { cookies: [], origins: [] } })

// Content pages. The short paths are next.config 308s onto /legal/*.
const LEGAL_PAGES = [
  { path: '/privacy',         heading: /Privacy Policy/i },
  { path: '/terms',           heading: /Terms of Service|Terms and Conditions/i },
  { path: '/acceptable-use',  heading: /Acceptable Use/i },
  { path: '/cookies',         heading: /Cookie/i },
]

for (const { path: route, heading } of LEGAL_PAGES) {
  test(`${route} renders for an anonymous visitor`, async ({ page }) => {
    const res = await page.goto(route)
    expect(res?.status(), `${route} should render, not redirect to auth`).toBeLessThan(400)
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  })

  test(`${route} contains POPIA / e-site.live reference`, async ({ page }) => {
    await page.goto(route)
    const body = await page.textContent('body')
    const hasExpectedContent =
      body!.toLowerCase().includes('e-site') ||
      body!.toLowerCase().includes('popia') ||
      body!.toLowerCase().includes('information')
    expect(hasExpectedContent).toBe(true)
  })
}

// The POPIA §23/§24 data-subject-request intake. /legal/privacy directs data
// subjects here, and a data subject exercising access/deletion rights is by
// definition somebody who may have no account at all.
test('/privacy/request DSR form is reachable without a session', async ({ page }) => {
  await page.goto('/privacy/request')
  await expect(page).not.toHaveURL(/\/login/)
  const body = await page.textContent('body')
  expect(body!.toLowerCase()).toMatch(/data subject|request|privacy|contact/i)
})

// POPIA §69(3)/§11(3) and ECTA §45: the objection mechanism must be
// unobstructed. A login wall obstructs it.
test('/unsubscribe is reachable without a session', async ({ page }) => {
  await page.goto('/unsubscribe')
  await expect(page).not.toHaveURL(/\/login/)
  const body = await page.textContent('body')
  expect(body!.toLowerCase()).toMatch(/unsubscribe|email|marketing/i)
})

// The RFC 8058 one-click target. The mailbox provider POSTs it with no
// cookies; a 307 to /login is recorded as a failed one-click and the provider
// stops offering the control.
test('POST /api/unsubscribe is not redirected to login', async ({ request }) => {
  const res = await request.post('/api/unsubscribe?user=00000000-0000-4000-8000-000000000000', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: 'List-Unsubscribe=One-Click',
    maxRedirects: 0,
  })
  const status = res.status()
  // 307 = middleware ate the one-click. 405 = the header is pointing at a page
  // route instead of a handler. Either way the provider's button silently
  // never works.
  expect(status, `got ${status}: the one-click never reached the handler`).not.toBe(307)
  expect(status, `got ${status}: the one-click never reached the handler`).not.toBe(405)
  // The all-zero UUID matches no profile, so the honest answer is 422 — never
  // a 200 claiming an opt-out that was never written.
  expect(status, `unexpected status ${status}`).toBe(422)
})

test('ECTA footer is present on the login page', async ({ page }) => {
  await page.goto('/login')
  const footer = page.locator('footer')
  if (await footer.isVisible()) {
    const footerText = await footer.textContent()
    expect(footerText).toMatch(/E-Site|registration|ECTA|§43/i)
  }
})
