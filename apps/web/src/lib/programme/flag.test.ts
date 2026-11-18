import { afterEach, describe, expect, it } from 'vitest'
import { programmeEnabled } from './flag'

const before = process.env.PROGRAMME_ENABLED
afterEach(() => {
  if (before === undefined) delete process.env.PROGRAMME_ENABLED
  else process.env.PROGRAMME_ENABLED = before
})

describe('programmeEnabled', () => {
  it('is on only for the exact string "true"', () => {
    delete process.env.PROGRAMME_ENABLED
    expect(programmeEnabled()).toBe(false)
    for (const v of ['', 'false', '1', 'TRUE', 'yes', ' true']) {
      process.env.PROGRAMME_ENABLED = v
      expect(programmeEnabled()).toBe(false)
    }
    process.env.PROGRAMME_ENABLED = 'true'
    expect(programmeEnabled()).toBe(true)
  })
})
