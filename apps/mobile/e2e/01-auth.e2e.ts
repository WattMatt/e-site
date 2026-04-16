/**
 * T-055: Auth E2E — login, session persistence, logout
 */
import { device, element, by, expect as detoxExpect, waitFor } from 'detox'
import { loginAs, logout } from './helpers/auth'

describe('Auth', () => {
  beforeEach(async () => {
    await device.launchApp({ newInstance: true })
  })

  it('shows login screen on fresh launch', async () => {
    await waitFor(element(by.id('login-email-input'))).toBeVisible().withTimeout(15_000)
    await detoxExpect(element(by.id('login-email-input'))).toBeVisible()
    await detoxExpect(element(by.id('login-password-input'))).toBeVisible()
    await detoxExpect(element(by.id('login-submit-button'))).toBeVisible()
  })

  it('logs in with valid credentials and shows dashboard', async () => {
    await loginAs()
    await detoxExpect(element(by.id('dashboard-screen'))).toBeVisible()
  })

  it('shows error on invalid credentials', async () => {
    await waitFor(element(by.id('login-email-input'))).toBeVisible().withTimeout(15_000)
    await element(by.id('login-email-input')).typeText('bad@example.com')
    await element(by.id('login-password-input')).typeText('wrongpassword')
    await element(by.id('login-submit-button')).tap()

    await waitFor(element(by.id('login-error-message'))).toBeVisible().withTimeout(10_000)
    await detoxExpect(element(by.id('login-error-message'))).toBeVisible()
  })

  it('session persists across app restart', async () => {
    await loginAs()
    // Restart without clearing state
    await device.launchApp({ newInstance: false })
    // Should land on dashboard — not login
    await waitFor(element(by.id('dashboard-screen'))).toBeVisible().withTimeout(15_000)
    await detoxExpect(element(by.id('dashboard-screen'))).toBeVisible()
  })

  it('can log out and is redirected to login', async () => {
    await loginAs()
    await logout()
    await detoxExpect(element(by.id('login-email-input'))).toBeVisible()
  })
})
