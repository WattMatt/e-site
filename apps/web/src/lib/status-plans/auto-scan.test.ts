import { describe, it, expect } from 'vitest'
import { countLinkedShapes, shouldAutoScan, type AutoScanInput } from './auto-scan'

const base: AutoScanInput = {
  purpose: 'distribution_schematic', canEdit: true, isPdf: true, hasFileUrl: true,
  shapeCount: 0, linkedShapeCount: 0, replaced: false,
}
const floorPlan: AutoScanInput = { ...base, purpose: 'tenant_layout' }

describe('shouldAutoScan', () => {
  it('scans a line-diagram PDF sheet with no shapes for an editor', () => {
    expect(shouldAutoScan(base)).toBe(true)
  })

  it('never for a read-only viewer', () => {
    expect(shouldAutoScan({ ...base, canEdit: false })).toBe(false)
    expect(shouldAutoScan({ ...floorPlan, canEdit: false })).toBe(false)
  })

  it('not once the sheet has any shape (re-runs are by hand)', () => {
    expect(shouldAutoScan({ ...base, shapeCount: 1 })).toBe(false)
  })

  it('a line diagram ignores the linked and replaced fields', () => {
    expect(shouldAutoScan({ ...base, replaced: true, shapeCount: 1, linkedShapeCount: 1 })).toBe(false)
    expect(shouldAutoScan({ ...base, linkedShapeCount: 5 })).toBe(true)
  })

  it('not for an image drawing or a sheet whose file link is missing', () => {
    expect(shouldAutoScan({ ...base, isPdf: false })).toBe(false)
    expect(shouldAutoScan({ ...base, hasFileUrl: false })).toBe(false)
    expect(shouldAutoScan({ ...floorPlan, isPdf: false })).toBe(false)
    expect(shouldAutoScan({ ...floorPlan, hasFileUrl: false })).toBe(false)
  })

  describe('floor plan', () => {
    it('scans a PDF sheet with no linked shapes', () => {
      expect(shouldAutoScan(floorPlan)).toBe(true)
    })

    it('scans when shapes exist but none is linked', () => {
      expect(shouldAutoScan({ ...floorPlan, shapeCount: 4, linkedShapeCount: 0 })).toBe(true)
    })

    it('does not scan once a shape is linked and the file is not replaced', () => {
      expect(shouldAutoScan({ ...floorPlan, shapeCount: 1, linkedShapeCount: 1 })).toBe(false)
    })

    it('scans a replaced sheet even though shapes are linked', () => {
      expect(shouldAutoScan({ ...floorPlan, shapeCount: 3, linkedShapeCount: 3, replaced: true })).toBe(true)
    })
  })
})

describe('countLinkedShapes', () => {
  it('counts only shapes with a node, so area-typed shapes never count', () => {
    expect(countLinkedShapes([{ nodeId: 'n1' }, { nodeId: null }, { nodeId: 'n2' }, { nodeId: null }])).toBe(2)
    expect(countLinkedShapes([{ nodeId: null }])).toBe(0)
    expect(countLinkedShapes([])).toBe(0)
  })
})
