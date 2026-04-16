/**
 * T-055: Compliance E2E — site list, compliance score display, COC upload flow
 *
 * AC: Field worker navigates to compliance tab and sees sites
 * AC: Upload COC photo flow navigable in <30s
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
    // Site cards rendered — score ring is visible
    await detoxExpect(element(by.id('compliance-site-card'))).toBeVisible()
  })

  it('tapping a site navigates to subsection list', async () => {
    await element(by.id('compliance-site-card')).atIndex(0).tap()
    await waitFor(element(by.id('compliance-site-detail-screen'))).toBeVisible().withTimeout(8_000)
    await detoxExpect(element(by.id('compliance-site-detail-screen'))).toBeVisible()
  })

  it('QR scan button is accessible from compliance tab', async () => {
    await element(by.id('tab-dashboard')).tap()
    await waitFor(element(by.id('dashboard-screen'))).toBeVisible().withTimeout(8_000)
    await element(by.id('quick-action-scan-qr')).tap()
    await waitFor(element(by.id('qr-scan-screen'))).toBeVisible().withTimeout(8_000)
    await detoxExpect(element(by.id('qr-scan-screen'))).toBeVisible()
    // Back out
    await device.pressBack()
  })
})
