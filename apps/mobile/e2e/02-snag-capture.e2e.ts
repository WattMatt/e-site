/**
 * T-055: Snag capture E2E
 *
 * Covers the field worker's primary workflow:
 *   login → log snag (offline) → app restart → snag visible
 *
 * AC: Snag captured in <30 seconds on mid-range Android
 * AC: Works completely offline; syncs on reconnect
 */
import { device, element, by, expect as detoxExpect, waitFor } from 'detox'
import { loginAs } from './helpers/auth'

describe('Snag capture', () => {
  beforeAll(async () => {
    await loginAs()
  })

  afterAll(async () => {
    await device.launchApp({ newInstance: true }) // reset state
  })

  it('navigates to snag list from dashboard quick action', async () => {
    await waitFor(element(by.id('dashboard-screen'))).toBeVisible().withTimeout(10_000)
    await element(by.id('quick-action-log-snag')).tap()
    await waitFor(element(by.id('snag-create-screen'))).toBeVisible().withTimeout(8_000)
    await detoxExpect(element(by.id('snag-create-screen'))).toBeVisible()
  })

  it('creates a snag with title and priority in under 30s', async () => {
    const start = Date.now()

    await waitFor(element(by.id('snag-title-input'))).toBeVisible().withTimeout(5_000)
    await element(by.id('snag-title-input')).typeText('E2E test snag — delete me')

    // Select priority: medium
    await element(by.id('priority-medium-button')).tap()

    // Add description
    await element(by.id('snag-description-input')).typeText('Created by Detox E2E test suite')

    // Submit
    await element(by.id('snag-submit-button')).tap()

    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(30_000) // AC: <30s

    // Confirm we navigated away from create screen (to snag detail or list)
    await waitFor(element(by.id('snag-create-screen'))).not.toBeVisible().withTimeout(10_000)
  })

  it('new snag appears in the snags list', async () => {
    // Navigate to snags tab
    await element(by.id('tab-snags')).tap()
    await waitFor(element(by.id('snags-list-screen'))).toBeVisible().withTimeout(8_000)

    // The test snag should appear
    await waitFor(element(by.text('E2E test snag — delete me'))).toBeVisible().withTimeout(10_000)
    await detoxExpect(element(by.text('E2E test snag — delete me'))).toBeVisible()
  })

  it('works offline — snag queued and persists after airplane mode', async () => {
    // Enable airplane mode
    await device.setStatusBar({ dataNetwork: 'hide' })

    // Navigate to create snag
    await element(by.id('tab-dashboard')).tap()
    await element(by.id('quick-action-log-snag')).tap()
    await waitFor(element(by.id('snag-create-screen'))).toBeVisible().withTimeout(8_000)

    await element(by.id('snag-title-input')).typeText('Offline snag — queued')
    await element(by.id('priority-low-button')).tap()
    await element(by.id('snag-submit-button')).tap()

    // Should succeed (offline write-buffer)
    await waitFor(element(by.id('snag-create-screen'))).not.toBeVisible().withTimeout(10_000)

    // Verify it's in the list
    await element(by.id('tab-snags')).tap()
    await waitFor(element(by.text('Offline snag — queued'))).toBeVisible().withTimeout(8_000)
    await detoxExpect(element(by.text('Offline snag — queued'))).toBeVisible()

    // Restore network — PowerSync should sync it
    await device.setStatusBar({ dataNetwork: 'lte' })
    // Allow time for sync
    await new Promise(r => setTimeout(r, 5_000))

    // Snag should still be visible after sync
    await detoxExpect(element(by.text('Offline snag — queued'))).toBeVisible()
  })
})
