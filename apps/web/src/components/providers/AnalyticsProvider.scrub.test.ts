import { describe, it, expect, vi } from 'vitest'

vi.mock('posthog-js', () => ({ default: {} }))
import { scrubUrl } from './AnalyticsProvider'

describe('scrubUrl (tender secrets never reach analytics)', () => {
  it('removes the invitation token, the single-use sign-in and the address', () => {
    expect(scrubUrl('/tender/invite/abcDEF_123-xyz?k=deadbeef&t=signup')).toBe('/tender/invite/[token]')
    expect(scrubUrl('https://www.e-site.live/tender/login?k=deadbeef&t=magiclink&e=bidder%40co.example&next=%2Ftender'))
      .toBe('https://www.e-site.live/tender/login?next=%2Ftender')
  })

  it('leaves ordinary URLs alone', () => {
    expect(scrubUrl('/projects/p1/tenders?tab=bids')).toBe('/projects/p1/tenders?tab=bids')
    expect(scrubUrl('https://www.e-site.live/dashboard')).toBe('https://www.e-site.live/dashboard')
  })
})
