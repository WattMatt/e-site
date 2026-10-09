import { describe, expect, it } from 'vitest'
import { isPowerSyncConfigured } from '../lib/powersync/config'

describe('isPowerSyncConfigured', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['   ', false],
    ['https://your-instance.powersync.journeyapps.com', false], // .env.example placeholder
    ['not a url', false],
    ['https://abc123.powersync.journeyapps.com', true],
  ])('%j → %s', (url, expected) => {
    expect(isPowerSyncConfigured(url)).toBe(expected)
  })
})
