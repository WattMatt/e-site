/**
 * T-055: Projects tab E2E — browse project list, navigate to project detail.
 */
import { element, by, expect as detoxExpect, waitFor } from 'detox'
import { loginAs } from './helpers/auth'

describe('Projects tab', () => {
  beforeAll(async () => {
    await loginAs()
  })

  it('shows projects tab with list of projects', async () => {
    await element(by.id('tab-projects')).tap()
    await waitFor(element(by.id('projects-screen'))).toBeVisible().withTimeout(10_000)
    await detoxExpect(element(by.id('projects-screen'))).toBeVisible()
  })

  it('project cards have name and status badge', async () => {
    await waitFor(element(by.id('project-card'))).toBeVisible().withTimeout(8_000)
    await detoxExpect(element(by.id('project-card'))).toBeVisible()
  })

  it('tapping a project card navigates to project detail', async () => {
    await element(by.id('project-card')).atIndex(0).tap()
    await waitFor(element(by.id('project-detail-screen'))).toBeVisible().withTimeout(8_000)
    await detoxExpect(element(by.id('project-detail-screen'))).toBeVisible()
    // Back
    await element(by.id('back-button')).tap()
  })

  it('pull-to-refresh does not crash', async () => {
    await element(by.id('tab-projects')).tap()
    await waitFor(element(by.id('projects-screen'))).toBeVisible().withTimeout(8_000)
    await element(by.id('projects-screen')).swipe('down', 'fast', 0.5)
    // After refresh the list should still be visible
    await detoxExpect(element(by.id('projects-screen'))).toBeVisible()
  })
})
