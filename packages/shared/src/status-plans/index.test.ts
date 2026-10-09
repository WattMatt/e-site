import { describe, it, expect } from 'vitest'
import * as sp from './index'

describe('@esite/shared/status-plans public surface', () => {
  it('exports the functions later slices are planned against', () => {
    for (const name of [
      'pointsError', 'statusPlanFromRow', 'statusPlanShapeFromRow',
      'shopStatus', 'isShopComplete',
      'dbBlockStatus',
      'rectToPoints', 'boundingBox', 'shapeAreaPx', 'shapeAreaM2', 'pointInShape', 'distanceToEdge', 'visualCentre', 'hatchSegments',
      'areaCheck', 'totalMeasuredM2',
      'tenantShapeStyle', 'areaShapeStyle', 'dbBlockStyle', 'hexToRgb01',
    ]) {
      expect(typeof (sp as Record<string, unknown>)[name], name).toBe('function')
    }
  })
  it('exports the constants', () => {
    expect(sp.STATUS_PLAN_PURPOSES).toEqual(['tenant_layout', 'distribution_schematic'])
    expect(sp.AREA_TYPES).toEqual(['common', 'plant_room', 'services', 'vacant'])
    expect(sp.AREA_TOLERANCE).toBe(0.02)
    expect(sp.TENANT_LEGEND.length).toBe(9)
    expect(sp.SCHEMATIC_LEGEND.length).toBe(6)
  })

  it('exports the detection surface (slice 3)', () => {
    for (const name of [
      'composeMatrix', 'textItemsToImageSpace',
      'detectBlocks',
      'normaliseTag', 'buildNodeIndex', 'matchBlock',
      'reviewDetection', 'runDetection', 'detectionSummary', 'detectedTagFor', 'boxesOverlap',
    ]) {
      expect(typeof (sp as Record<string, unknown>)[name], name).toBe('function')
    }
    expect(sp.BLOCK_LABELS).toEqual(['NO', 'NAME', 'AREA', 'RATING', 'CABLE', 'SERIAL', 'CT'])
    expect(sp.DETECTED_TAG_MAX).toBe(64)
  })
})
