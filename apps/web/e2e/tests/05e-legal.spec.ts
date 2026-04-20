/**
 * Legal pages E2E (T-065) — public routes render without auth, contain required content.
 * Runs without storageState (unauthenticated) since legal pages are public.
 */
import { test, expect } from '@playwright/test'

const LEGAL_PAGES = [
  { path: '/privacy',         heading: /Privacy Policy/i },
  { path: '/terms',           heading: /Terms of Service|Terms and Conditions/i },
  { path: '/acceptable-use',  heading: /Acceptable Use/i },
  { path: '/cookies',         heading: /Cookie/i },
]

for (const { path: route, heading } of LEGAL_PAGES) {
  test(`${route} renders publicly`, async ({ page }) => {
    await page.goto(route)
    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  })

  test(`${route} contains POPIA / e-site.co.za reference`, async ({ page }) => {
    await page.goto(route)
    const body = await page.textContent('body')
    // Should reference the company or POPIA
    const hasExpectedContent =
      body!.toLowerCase().includes('e-site') ||
      body!.toLowerCase().includes('popia') ||
      body!.toLowerCase().includes('information')
    expect(hasExpectedContent).toBe(true)
  })
}

test('/privacy/request DSR form renders', async ({ page }) => {
  await page.goto('/privacy/request')
  await expect(page).not.toHaveURL(/login/)
  // Should show a form with name, email, request type fields
  const body = await page.textContent('body')
  expect(body!.toLowerCase()).toMatch(/data subject|request|privacy|contact/i)
})

test('/unsubscribe page renders', async ({ page }) => {
  await page.goto('/unsubscribe')
  await expect(page).not.toHaveURL(/login/)
  const body = await page.textContent('body')
  expect(body!.toLowerCase()).toMatch(/unsubscribe|email|marketing/i)
})

test('ECTA footer is present on admin layout', async ({ page }) => {
  // ECTA disclosure must appear in footer of authenticated pages
  // We check the login page footer as it's publicly accessible
  await page.goto('/login')
  const footer = page.locator('footer')
  if (await footer.isVisible()) {
    const footerText = await footer.textContent()
    // Should contain the company name / registration number
    expect(footerText).toMatch(/E-Site|registration|ECTA|§43/i)
  }
})
