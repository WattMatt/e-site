/**
 * Projects E2E — create project and verify it appears in the list.
 */
import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../auth.json') })

const TEST_PROJECT_NAME = `E2E Project ${Date.now()}`

test.describe('Projects', () => {
  test('projects list loads', async ({ page }) => {
    await page.goto('/projects')
    await expect(page.getByRole('heading', { name: /Projects/i })).toBeVisible()
  })

  test('can navigate to new project form', async ({ page }) => {
    await page.goto('/projects/new')
    await expect(page.getByRole('heading', { name: /New Project/i })).toBeVisible()
  })

  test('creates a new project', async ({ page }) => {
    await page.goto('/projects/new')

    await page.getByLabel(/Project name/i).fill(TEST_PROJECT_NAME)
    await page.getByLabel(/Address/i).fill('1 Test Street')
    await page.getByLabel(/City/i).fill('Johannesburg')
    await page.getByLabel(/Client name/i).fill('E2E Client')

    await page.getByRole('button', { name: /Create Project/i }).click()

    // Should redirect to new project page
    await page.waitForURL(/\/projects\/[a-f0-9-]+/, { timeout: 10_000 })
    await expect(page.getByText(TEST_PROJECT_NAME)).toBeVisible()
  })

  test('project appears in projects list after creation', async ({ page }) => {
    await page.goto('/projects')
    await expect(page.getByText(TEST_PROJECT_NAME)).toBeVisible()
  })
})
