/**
 * JBCC paywall — three invariants.
 *
 * 1. Locked org sees the /jbcc/unlock page with the CTA, NOT library content.
 * 2. `POST /api/paystack/feature-unlock { feature_key: 'jbcc' }` enforces
 *    OWNER_ADMIN — a contractor role must receive 403.
 * 3. Non-owner of an unlocked org sees the feature but the unlock CTA is
 *    hidden. (Behaviour skipped — see note below.)
 *
 * Self-contained — no shared auth.setup fixture. Tests log in inline and
 * only run when the required env vars are set. Missing vars cause the entire
 * describe block to skip without failing the suite.
 *
 * Required env vars:
 *   E2E_CONTRACTOR_EMAIL         — contractor on a LOCKED-for-JBCC org
 *   E2E_CONTRACTOR_PASSWORD      — default: Demo@esite2025!
 *   E2E_JBCC_LOCKED_PROJECT_ID   — a project ID belonging to that locked org
 *
 * Optional (for behaviour 3 — see comment in that test):
 *   E2E_JBCC_UNLOCKED_PROJECT_ID — project in a JBCC-unlocked org
 *
 * Suggested seed (in your dev DB):
 *   - Email:     demo.contractor@wmeng.co.za
 *   - Password:  Demo@esite2025!
 *   - Role:      contractor on a test org that does NOT have JBCC unlocked
 *   - Org must have at least one project; supply its ID via
 *     E2E_JBCC_LOCKED_PROJECT_ID.
 */
import { test, expect } from '@playwright/test'

const CONTRACTOR_EMAIL = process.env.E2E_CONTRACTOR_EMAIL
const CONTRACTOR_PASS  = process.env.E2E_CONTRACTOR_PASSWORD ?? 'Demo@esite2025!'
const LOCKED_PROJECT   = process.env.E2E_JBCC_LOCKED_PROJECT_ID

const SKIP_REASON =
  'E2E_CONTRACTOR_EMAIL or E2E_JBCC_LOCKED_PROJECT_ID not set — ' +
  'seed a contractor demo user in a JBCC-locked org to enable JBCC paywall tests'

// ---------------------------------------------------------------------------
// Behaviour 1 & 2 — contractor on a locked org
// ---------------------------------------------------------------------------
test.describe('JBCC paywall: locked org + role-gated unlock endpoint', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!CONTRACTOR_EMAIL || !LOCKED_PROJECT, SKIP_REASON)

    await page.goto('/login')
    await page.getByLabel('Email').fill(CONTRACTOR_EMAIL!)
    await page.getByLabel('Password').fill(CONTRACTOR_PASS)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await page.waitForURL('**/dashboard', { timeout: 15_000 })
  })

  test('locked org: /jbcc redirects to /jbcc/unlock and shows the CTA heading', async ({ page }) => {
    await page.goto(`/projects/${LOCKED_PROJECT}/jbcc`)

    // The layout gate redirects to /unlock — confirm we arrived there.
    await expect(page).toHaveURL(new RegExp(`/projects/${LOCKED_PROJECT}/jbcc/unlock`))

    // The unlock page heading must be visible.
    await expect(page.getByRole('heading', { name: /JBCC Procedural Toolkit/i })).toBeVisible()

    // Library content must NOT be present.
    await expect(page.getByText(/Notice Library/i)).not.toBeVisible()
    await expect(page.getByText(/Generate letter/i)).not.toBeVisible()
  })

  test('locked org: unlock page shows the R1 999.00 price', async ({ page }) => {
    await page.goto(`/projects/${LOCKED_PROJECT}/jbcc/unlock`)
    await expect(page).toHaveURL(new RegExp(`/projects/${LOCKED_PROJECT}/jbcc/unlock`))
    // Price text — formatZARFromKobo(199900) renders as "R1 999.00" or "R 1,999.00"
    // depending on locale; match the core numeric portion.
    await expect(page.getByText(/1.?999/)).toBeVisible()
  })

  test('POST /api/paystack/feature-unlock returns 403 for contractor', async ({ page, request }) => {
    const cookies    = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    const res = await request.post('/api/paystack/feature-unlock', {
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      data: { feature_key: 'jbcc' },
      failOnStatusCode: false,
    })

    expect(res.status()).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Behaviour 3 — non-owner of an UNLOCKED org sees feature, not unlock CTA
//
// Setup gap: this test requires a second test org that already has JBCC
// unlocked AND a contractor user seeded in it. The e2e seed only provisions a
// locked org. Until a second org is seeded and E2E_JBCC_UNLOCKED_PROJECT_ID
// is set, this entire describe block is skipped.
// ---------------------------------------------------------------------------
test.describe('JBCC paywall: unlocked org — contractor sees feature, not CTA', () => {
  const UNLOCKED_PROJECT = process.env.E2E_JBCC_UNLOCKED_PROJECT_ID
  const SKIP_UNLOCKED =
    'E2E_CONTRACTOR_EMAIL or E2E_JBCC_UNLOCKED_PROJECT_ID not set — ' +
    'seed a contractor in a JBCC-unlocked org to enable this invariant'

  test.beforeEach(async ({ page }) => {
    test.skip(!CONTRACTOR_EMAIL || !UNLOCKED_PROJECT, SKIP_UNLOCKED)

    await page.goto('/login')
    await page.getByLabel('Email').fill(CONTRACTOR_EMAIL!)
    await page.getByLabel('Password').fill(CONTRACTOR_PASS)
    await page.getByRole('button', { name: 'Sign In' }).click()
    await page.waitForURL('**/dashboard', { timeout: 15_000 })
  })

  test('unlocked org: contractor reaches library, unlock CTA absent', async ({ page }) => {
    await page.goto(`/projects/${UNLOCKED_PROJECT}/jbcc`)

    // Must NOT be redirected to /unlock
    await expect(page).not.toHaveURL(/\/jbcc\/unlock/)

    // Library content must be visible
    await expect(page.getByText(/JBCC Procedural Toolkit/i)).toBeVisible()

    // The "Unlock for R…" CTA button must NOT appear (only owner/admin sees it)
    await expect(page.getByRole('button', { name: /Unlock for/i })).not.toBeVisible()
  })
})
