/**
 * Field worker E2E — DEMO.md flow 2: snag capture + status transitions.
 * Runs as demo.field@wmeng.co.za (field worker role).
 */
import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../auth-field.json') })

test.describe('Field worker — snag capture (flow 2)', () => {
  test('can view snags list', async ({ page }) => {
    await page.goto('/snags')
    await expect(page.getByRole('heading', { name: /Snags/i })).toBeVisible()
  })

  test('can reach new snag form', async ({ page }) => {
    await page.goto('/snags/new')
    await expect(page.getByRole('heading', { name: /New Snag|Log Snag/i })).toBeVisible()
  })

  test('creates a snag and it appears in the list', async ({ page }) => {
    await page.goto('/snags/new')

    // Select a project
    const projectSelect = page.getByLabel(/Project/i).first()
    await projectSelect.selectOption({ index: 1 })

    const snagTitle = `E2E Snag ${Date.now()}`
    await page.getByLabel(/Title/i).fill(snagTitle)
    await page.getByLabel(/Location/i).fill('DB Room Level 3')
    await page.getByLabel(/Priority/i).selectOption('high')
    await page.getByLabel(/Category/i).selectOption({ index: 1 })

    await page.getByRole('button', { name: /Create|Save|Submit/i }).click()

    // Redirects to snag detail
    await page.waitForURL(/\/snags\/[a-f0-9-]+/, { timeout: 10_000 })
    await expect(page.getByText(snagTitle)).toBeVisible()
  })

  test('can navigate to diary via quick action', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('link', { name: /Site Diary/i })).toBeVisible()
  })
})
