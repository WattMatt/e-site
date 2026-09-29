import { describe, expect, it } from 'vitest'
import * as engine from './index'

describe('@esite/shared/solar-engine barrel', () => {
  it('exposes a semver ENGINE_VERSION', () => {
    expect(engine.ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
