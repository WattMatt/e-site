/**
 * Theme E2E — verifies light/dark/system resolution on first paint.
 * Runs without storageState (the public /login page renders the root layout,
 * which sets <html data-theme> from the `theme` cookie; System falls back to
 * the prefers-color-scheme media query with no attribute).
 */
import { test, expect } from '@playwright/test'

const DARK_BASE = 'rgb(11, 11, 18)'    // --c-base dark  (#0B0B12)
const LIGHT_BASE = 'rgb(236, 231, 221)' // --c-base light (#ECE7DD, "warm paper")

test.describe('theme resolution', () => {
  test('explicit dark cookie → data-theme="dark" + dark palette', async ({ context, page }) => {
    await context.addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3000' }])
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(bg).toBe(DARK_BASE)
  })

  test('explicit light cookie → data-theme="light" + warm-paper palette', async ({ context, page }) => {
    await context.addCookies([{ name: 'theme', value: 'light', url: 'http://localhost:3000' }])
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(bg).toBe(LIGHT_BASE)
  })

  test.describe('system mode follows the OS (no cookie, no attribute)', () => {
    test.describe('dark OS', () => {
      test.use({ colorScheme: 'dark' })
      test('renders the dark palette with no data-theme attribute', async ({ page }) => {
        await page.goto('/login')
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
        expect(bg).toBe(DARK_BASE)
      })
    })

    test.describe('light OS', () => {
      test.use({ colorScheme: 'light' })
      test('renders the warm-paper palette with no data-theme attribute', async ({ page }) => {
        await page.goto('/login')
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
        expect(bg).toBe(LIGHT_BASE)
      })
    })
  })
})
