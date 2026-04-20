/**
 * Auth setup — signs in as each demo role and saves auth state so test
 * specs can skip the login flow entirely via storageState.
 *
 * Saves:
 *   e2e/auth.json         — owner (demo.owner@wmeng.co.za)
 *   e2e/auth-field.json   — field worker (demo.field@wmeng.co.za)
 *   e2e/auth-client.json  — client viewer (demo.client@wmeng.co.za)
 */
import { test as setup, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const E2E_DIR = path.join(__dirname, '..')

async function signIn(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
  outFile: string,
) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign In' }).click()
  await page.waitForURL('**/dashboard', { timeout: 15_000 })
  await expect(page).toHaveURL(/dashboard/)
  await page.context().storageState({ path: outFile })
  await page.context().clearCookies()
}

const OWNER_EMAIL    = process.env.E2E_USER_EMAIL    ?? 'demo.owner@wmeng.co.za'
const OWNER_PASS     = process.env.E2E_USER_PASSWORD ?? 'Demo@esite2025!'
const FIELD_EMAIL    = process.env.E2E_FIELD_EMAIL   ?? 'demo.field@wmeng.co.za'
const FIELD_PASS     = process.env.E2E_FIELD_PASSWORD ?? 'Demo@esite2025!'
const CLIENT_EMAIL   = process.env.E2E_CLIENT_EMAIL  ?? 'demo.client@wmeng.co.za'
const CLIENT_PASS    = process.env.E2E_CLIENT_PASSWORD ?? 'Demo@esite2025!'

setup('authenticate — owner role', async ({ page }) => {
  await signIn(page, OWNER_EMAIL, OWNER_PASS, path.join(E2E_DIR, 'auth.json'))
})

setup('authenticate — field worker role', async ({ page }) => {
  await signIn(page, FIELD_EMAIL, FIELD_PASS, path.join(E2E_DIR, 'auth-field.json'))
})

setup('authenticate — client viewer role', async ({ page }) => {
  await signIn(page, CLIENT_EMAIL, CLIENT_PASS, path.join(E2E_DIR, 'auth-client.json'))
})
