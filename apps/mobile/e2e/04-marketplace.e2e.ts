/**
 * T-055: Marketplace E2E — browse catalogue, view supplier
 *
 * Marketplace is Phase 2 (deferred). Mobile marketplace screens don't exist yet.
 * Tests are skipped until Phase 2 is implemented.
 */
import { device, element, by, expect as detoxExpect, waitFor } from 'detox'
import { loginAs } from './helpers/auth'

describe.skip('Marketplace (Phase 2 — screens not yet implemented)', () => {
  beforeAll(async () => {
    await loginAs()
  })

  it('navigates to marketplace from dashboard quick action', async () => {
    await waitFor(element(by.id('dashboard-screen'))).toBeVisible().withTimeout(10_000)
    await element(by.id('quick-action-marketplace')).tap()
    await waitFor(element(by.id('marketplace-screen'))).toBeVisible().withTimeout(10_000)
    await detoxExpect(element(by.id('marketplace-screen'))).toBeVisible()
  })

  it('shows supplier cards in the catalogue', async () => {
    await waitFor(element(by.id('supplier-card'))).toBeVisible().withTimeout(10_000)
    await detoxExpect(element(by.id('supplier-card'))).toBeVisible()
  })

  it('tapping a supplier card shows their catalogue', async () => {
    await element(by.id('supplier-card')).atIndex(0).tap()
    await waitFor(element(by.id('supplier-detail-screen'))).toBeVisible().withTimeout(8_000)
    await detoxExpect(element(by.id('supplier-detail-screen'))).toBeVisible()
    // Back
    await device.pressBack()
  })
})
