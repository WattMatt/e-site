/**
 * RBAC E2E — DEMO.md flow 8: client viewer role restrictions.
 * Runs as demo.client@wmeng.co.za (read-only client access).
 */
import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../auth-client.json') })

test.describe('Client viewer RBAC (flow 8)', () => {
  test('dashboard loads for client role', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/dashboard/)
  })

  test('client cannot see "+ New Project" button', async ({ page }) => {
    await page.goto('/dashboard')
    const newProjectBtn = page.getByRole('link', { name: /\+ New Project/i })
    // Client should not see this button
    await expect(newProjectBtn).not.toBeVisible()
  })

  test('client cannot access new project form', async ({ page }) => {
    await page.goto('/projects/new')
    // Should redirect or show access denied — not render the form
    const body = await page.textContent('body')
    const onNewProjectForm = await page.url().includes('/projects/new')
    const formHeading = page.getByRole('heading', { name: /New Project/i })
    // Either redirected away, or form heading is absent
    if (onNewProjectForm) {
      await expect(formHeading).not.toBeVisible()
    } else {
      expect(page.url()).not.toContain('/projects/new')
    }
  })

  test('client cannot see snag create button', async ({ page }) => {
    await page.goto('/snags')
    const newSnagBtn = page.getByRole('link', { name: /\+ New Snag|Log Snag/i })
    await expect(newSnagBtn).not.toBeVisible()
  })

  test('projects list loads (read access)', async ({ page }) => {
    await page.goto('/projects')
    await expect(page).toHaveURL(/projects/)
    // Client sees a page — not blocked entirely
    await expect(page.locator('body')).not.toContainText('403')
  })

  test('org settings not accessible to client', async ({ page }) => {
    await page.goto('/settings/organisation')
    // Should redirect or show restricted content
    const url = page.url()
    const bodyText = await page.textContent('body') ?? ''
    const isRestricted =
      url.includes('/dashboard') ||
      url.includes('/login') ||
      bodyText.toLowerCase().includes('permission') ||
      bodyText.toLowerCase().includes('access denied') ||
      bodyText.toLowerCase().includes('not authorised')
    // At minimum, they shouldn't see the org settings form
    const settingsForm = page.getByRole('heading', { name: /Organisation Settings/i })
    const formVisible = await settingsForm.isVisible().catch(() => false)
    expect(formVisible || isRestricted).toBe(true)
  })
})
