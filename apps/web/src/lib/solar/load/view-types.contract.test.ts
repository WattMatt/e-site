// apps/web/src/lib/solar/load/view-types.contract.test.ts
import { describe, it, expect } from 'vitest'
import { COMMITTABLE_UNITS } from '@/lib/solar/meter-import/commit'
import { UNIT_OPTIONS } from './view-types'

describe('UNIT_OPTIONS', () => {
  it('is exactly the set the commit route accepts', () => {
    expect([...UNIT_OPTIONS].sort()).toEqual([...COMMITTABLE_UNITS].sort())
  })
})
