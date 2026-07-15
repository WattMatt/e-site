import { describe, it, expect } from 'vitest'
import { toSceneGraph } from './qc-photos'
import type { AnnotationData } from '@/components/attachments/types'
import type { SceneGraph } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/MarkupCanvas'

// toSceneGraph normalises whatever is stored in qc_entry_photos.annotation_data
// into the full MarkupCanvas SceneGraph so re-edit can hydrate it. New markups
// are already SceneGraphs (pass-through); the rare legacy AnnotationData row is
// converted. Detection keys off canvas.w (SceneGraph) vs canvas.width (legacy).

describe('toSceneGraph', () => {
  it('passes a SceneGraph through untouched (detected via canvas.w)', () => {
    const scene: SceneGraph = {
      version: 1,
      canvas: { w: 1024, h: 768 },
      pageCount: 3,
      shapes: [
        { id: 'a', type: 'symbol', kind: 'db', x: 10, y: 20, size: 46, color: '#dc2626' },
        { id: 'b', type: 'measure', points: [0, 0, 100, 0], color: '#16a34a', strokeWidth: 4 },
      ],
    }
    const out = toSceneGraph(scene)
    // Same reference — no copy, no conversion.
    expect(out).toBe(scene)
    expect(out.canvas).toEqual({ w: 1024, h: 768 })
    expect(out.shapes).toHaveLength(2)
  })

  it('converts a legacy AnnotationData to a SceneGraph', () => {
    const legacy: AnnotationData = {
      version: 1,
      canvas: { width: 800, height: 600 },
      baseImage: { naturalWidth: 800, naturalHeight: 600, signedUrl: 'https://x/plan.png' },
      shapes: [
        { id: 's1', type: 'pen', color: '#ef4444', points: [1, 2, 3, 4], strokeWidth: 3 },
        { id: 's2', type: 'arrow', color: '#3b82f6', points: [0, 0, 10, 10], strokeWidth: 2 },
        { id: 's3', type: 'rect', color: '#22c55e', x: 5, y: 6, width: 20, height: 30, strokeWidth: 2 },
        { id: 's4', type: 'circle', color: '#f59e0b', x: 50, y: 60, radius: 15, strokeWidth: 4 },
        { id: 's5', type: 'text', color: '#000000', x: 7, y: 8, text: 'hi', fontSize: 16 },
        { id: 's6', type: 'pin', color: '#ffffff', x: 9, y: 11 },
      ],
    }

    const out = toSceneGraph(legacy)

    // canvas.width/height → canvas.w/h
    expect(out.version).toBe(1)
    expect(out.canvas).toEqual({ w: 800, h: 600 })
    expect(out.shapes).toHaveLength(6)

    // pen / arrow / rect / text carry over with the same primitive type + fields.
    expect(out.shapes[0]).toEqual({ id: 's1', type: 'pen', color: '#ef4444', points: [1, 2, 3, 4], strokeWidth: 3 })
    expect(out.shapes[1]).toEqual({ id: 's2', type: 'arrow', color: '#3b82f6', points: [0, 0, 10, 10], strokeWidth: 2 })
    expect(out.shapes[2]).toEqual({ id: 's3', type: 'rect', color: '#22c55e', x: 5, y: 6, width: 20, height: 30, strokeWidth: 2 })
    expect(out.shapes[4]).toEqual({ id: 's5', type: 'text', color: '#000000', x: 7, y: 8, text: 'hi', fontSize: 16 })

    // circle → equal-radii ellipse (the full canvas has no circle primitive).
    expect(out.shapes[3]).toEqual({
      id: 's4',
      type: 'ellipse',
      color: '#f59e0b',
      cx: 50,
      cy: 60,
      rx: 15,
      ry: 15,
      strokeWidth: 4,
    })

    // pin with no label → label defaults to '' (SceneGraph pins require a label).
    expect(out.shapes[5]).toEqual({ id: 's6', type: 'pin', color: '#ffffff', x: 9, y: 11, label: '' })
  })

  it('preserves an explicit legacy pin label', () => {
    const legacy: AnnotationData = {
      version: 1,
      canvas: { width: 100, height: 100 },
      baseImage: { naturalWidth: 100, naturalHeight: 100 },
      shapes: [{ id: 'p', type: 'pin', color: '#000000', x: 1, y: 2, label: '7' }],
    }
    const out = toSceneGraph(legacy)
    expect(out.shapes[0]).toMatchObject({ type: 'pin', label: '7' })
  })

  it('is defensive about a legacy row with no shapes / dims', () => {
    // A malformed/partial legacy blob still yields a valid empty SceneGraph.
    const partial = { version: 1, canvas: { width: 0, height: 0 }, baseImage: { naturalWidth: 0, naturalHeight: 0 } } as AnnotationData
    const out = toSceneGraph(partial)
    expect(out).toEqual({ version: 1, canvas: { w: 0, h: 0 }, shapes: [] })
  })
})
