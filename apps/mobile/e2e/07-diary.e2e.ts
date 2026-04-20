/**
 * T-055: Site Diary E2E — view diary entries, add new entry.
 */
import { device, element, by, expect as detoxExpect, waitFor } from 'detox'
import { loginAs } from './helpers/auth'

describe('Site Diary', () => {
  beforeAll(async () => {
    await loginAs()
  })

  it('navigates to a project diary screen', async () => {
    // Access diary from Projects tab → first project
    await element(by.id('tab-projects')).tap()
    await waitFor(element(by.id('project-card'))).toBeVisible().withTimeout(10_000)
    await element(by.id('project-card')).atIndex(0).tap()

    await waitFor(element(by.id('project-detail-screen'))).toBeVisible().withTimeout(8_000)
    // Tap site diary link within project detail
    await waitFor(element(by.id('project-diary-link'))).toBeVisible().withTimeout(5_000)
    await element(by.id('project-diary-link')).tap()

    await waitFor(element(by.id('diary-screen'))).toBeVisible().withTimeout(10_000)
    await detoxExpect(element(by.id('diary-screen'))).toBeVisible()
  })

  it('shows diary entries or empty state', async () => {
    await waitFor(element(by.id('diary-screen'))).toBeVisible().withTimeout(8_000)
    // Either diary-entry-card or empty-state should be visible
    let hasEntries = false
    try { await waitFor(element(by.id('diary-entry-card'))).toBeVisible().withTimeout(1000); hasEntries = true } catch {}
    let isEmpty = false
    try { await waitFor(element(by.id('diary-empty-state'))).toBeVisible().withTimeout(1000); isEmpty = true } catch {}
    expect(hasEntries || isEmpty).toBe(true)
  })

  it('can open the add entry form', async () => {
    await element(by.id('diary-add-button')).tap()
    await waitFor(element(by.id('diary-entry-form'))).toBeVisible().withTimeout(5_000)
    await detoxExpect(element(by.id('diary-entry-form'))).toBeVisible()
    // Dismiss
    await element(by.id('diary-cancel-button')).tap()
  })

  it('creates a diary entry with progress notes', async () => {
    await element(by.id('diary-add-button')).tap()
    await waitFor(element(by.id('diary-progress-input'))).toBeVisible().withTimeout(5_000)

    await element(by.id('diary-progress-input')).typeText('E2E test diary entry — installed DB conduit.')
    await element(by.id('diary-workers-input')).typeText('4')
    await element(by.id('diary-save-button')).tap()

    await waitFor(element(by.id('diary-entry-form'))).not.toBeVisible().withTimeout(10_000)
    // Entry should appear in the list
    await waitFor(element(by.text('E2E test diary entry — installed DB conduit.'))).toBeVisible().withTimeout(8_000)
    await detoxExpect(element(by.text('E2E test diary entry — installed DB conduit.'))).toBeVisible()
  })
})
