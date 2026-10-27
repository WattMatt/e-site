import { describe, it, expect } from 'vitest'
import { shouldAutoScan, type AutoScanInput } from './auto-scan'

const base: AutoScanInput = {
  purpose: 'distribution_schematic', canEdit: true, isPdf: true, hasFileUrl: true, shapeCount: 0,
}

describe('shouldAutoScan', () => {
  it('scans a line-diagram PDF sheet with no shapes for an editor', () => {
    expect(shouldAutoScan(base)).toBe(true)
  })

  it('never for a read-only viewer', () => {
    expect(shouldAutoScan({ ...base, canEdit: false })).toBe(false)
  })

  it('not once the sheet has any shape (re-runs are by hand)', () => {
    expect(shouldAutoScan({ ...base, shapeCount: 1 })).toBe(false)
  })

  it('not for a floor plan', () => {
    expect(shouldAutoScan({ ...base, purpose: 'tenant_layout' })).toBe(false)
  })

  it('not for an image drawing or a sheet whose file link is missing', () => {
    expect(shouldAutoScan({ ...base, isPdf: false })).toBe(false)
    expect(shouldAutoScan({ ...base, hasFileUrl: false })).toBe(false)
  })
})
