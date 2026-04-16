/**
 * Detox E2E auth helpers
 * Fills in login form and waits for dashboard.
 */
import { device, element, by, expect as detoxExpect, waitFor } from 'detox'

const TEST_EMAIL = process.env.E2E_USER_EMAIL ?? 'e2e@esite.test'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD ?? 'TestPass123!'

export async function loginAs(email = TEST_EMAIL, password = TEST_PASSWORD) {
  // Ensure we start from the login screen
  await device.launchApp({ newInstance: true })

  await waitFor(element(by.id('login-email-input'))).toBeVisible().withTimeout(15_000)
  await element(by.id('login-email-input')).clearText()
  await element(by.id('login-email-input')).typeText(email)
  await element(by.id('login-password-input')).clearText()
  await element(by.id('login-password-input')).typeText(password)
  await element(by.id('login-submit-button')).tap()

  // Wait for dashboard tab to confirm login succeeded
  await waitFor(element(by.id('dashboard-screen'))).toBeVisible().withTimeout(20_000)
}

export async function logout() {
  // Navigate to settings
  await element(by.id('tab-settings')).tap()
  await waitFor(element(by.id('settings-screen'))).toBeVisible().withTimeout(5_000)
  await element(by.id('settings-logout-button')).tap()
  await waitFor(element(by.id('login-email-input'))).toBeVisible().withTimeout(10_000)
}
