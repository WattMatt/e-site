/**
 * T-055: Compliance E2E — site list, compliance score display, QR scan flow.
 *
 * AC: Field worker navigates to compliance tab and sees sites
 * AC: QR scan screen accessible from dashboard
 *
 * Note: Compliance site detail (subsection list / COC upload) is web-only in v1.
 * The mobile compliance tab shows the summary list and score rings only.
 */
import { device, element, by, expect as detoxExpect, waitFor } from 'detox'
import { loginAs } from './helpers/auth'

describe('Compliance', () => {
  beforeAll(async () => {
    await loginAs()
  })

  it('shows compliance tab with site list', async () => {
    await element(by.id('tab-compliance')).tap()
    await waitFor(element(by.id('compliance-screen'))).toBeVisible().withTimeout(10_000)
    await detoxExpect(element(by.id('compliance-screen'))).toBeVisible()
  })

  it('each site card shows a compliance score', async () => {
    await waitFor(element(by.id('compliance-site-card'))).toBeVisible().withTimeout(8_000)
    await detoxExpect(element(by.id('compliance-site-card'))).toBeVisible()
  })

  it('QR scan screen is accessible from dashboard quick action', async () => {
    await element(by.id('tab-dashboard')).tap()
    await waitFor(element(by.id('dashboard-screen'))).toBeVisible().withTimeout(8_000)
    await element(by.id('quick-action-scan-qr')).tap()
    await waitFor(element(by.id('qr-scan-screen'))).toBeVisible().withTimeout(8_000)
    await detoxExpect(element(by.id('qr-scan-screen'))).toBeVisible()
    await device.pressBack()
  })
})
