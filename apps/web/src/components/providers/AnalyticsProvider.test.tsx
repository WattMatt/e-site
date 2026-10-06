import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'

const calls: string[] = []
vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(() => calls.push('init')),
    capture: vi.fn((event: string) => calls.push(`capture:${event}`)),
  },
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams('tab=open'),
}))

async function loadProvider() {
  // PH_KEY is read at module load, so import after stubbing the env.
  vi.resetModules()
  return (await import('./AnalyticsProvider')).AnalyticsProvider
}

describe('AnalyticsProvider', () => {
  beforeEach(() => {
    calls.length = 0
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sends the landing page view — init happens before the first capture', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
    const AnalyticsProvider = await loadProvider()
    const posthog = (await import('posthog-js')).default

    render(<AnalyticsProvider><p>page</p></AnalyticsProvider>)

    // Before the fix the first effect ran before init and the view was dropped.
    expect(calls).toEqual(['init', 'capture:$pageview'])
    expect(posthog.capture).toHaveBeenCalledWith('$pageview', { $current_url: '/dashboard?tab=open' })
  })

  it('does nothing without a key', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '')
    const AnalyticsProvider = await loadProvider()

    render(<AnalyticsProvider><p>page</p></AnalyticsProvider>)

    expect(calls).toEqual([])
  })
})
