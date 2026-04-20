/**
 * T-055: RFIs E2E — create screen and field validation.
 *
 * RFIs don't have a dedicated tab — they're accessed via a project detail.
 * Navigation: Projects tab → first project card → New RFI button → create screen.
 */
import { device, element, by, expect as detoxExpect, waitFor } from 'detox'
import { loginAs } from './helpers/auth'

describe('RFIs', () => {
  beforeAll(async () => {
    await loginAs()
  })

  it('navigates to a project and opens the New RFI screen', async () => {
    await element(by.id('tab-projects')).tap()
    await waitFor(element(by.id('project-card'))).toBeVisible().withTimeout(10_000)
    await element(by.id('project-card')).atIndex(0).tap()

    await waitFor(element(by.id('project-detail-screen'))).toBeVisible().withTimeout(8_000)
    await element(by.text('+ New RFI')).tap()

    await waitFor(element(by.id('rfi-create-screen'))).toBeVisible().withTimeout(8_000)
    await detoxExpect(element(by.id('rfi-create-screen'))).toBeVisible()
  })

  it('create RFI form has subject field', async () => {
    // Assumes we are already on the create screen from the previous test.
    // If not, navigate there again.
    let onCreateScreen = false
    try { await waitFor(element(by.id('rfi-create-screen'))).toBeVisible().withTimeout(1000); onCreateScreen = true } catch {}
    if (!onCreateScreen) {
      await element(by.id('tab-projects')).tap()
      await waitFor(element(by.id('project-card'))).toBeVisible().withTimeout(10_000)
      await element(by.id('project-card')).atIndex(0).tap()
      await waitFor(element(by.id('project-detail-screen'))).toBeVisible().withTimeout(8_000)
      await element(by.text('+ New RFI')).tap()
      await waitFor(element(by.id('rfi-create-screen'))).toBeVisible().withTimeout(8_000)
    }

    await waitFor(element(by.id('rfi-subject-input'))).toBeVisible().withTimeout(5_000)
    await detoxExpect(element(by.id('rfi-subject-input'))).toBeVisible()
    await device.pressBack()
  })
})
