import { describe, it, expect, vi, afterEach } from 'vitest'
import { toSceneGraph, replaceQcMarkup, downscaleImageBlob } from './qc-photos'
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

// ─────────────────────────────────────────────────────────────────────────────
// downscaleImageBlob — S3 markup downscale helper
// ─────────────────────────────────────────────────────────────────────────────

describe('downscaleImageBlob', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('passes a non-image blob straight through', async () => {
    const blob = new Blob(['x'], { type: 'text/plain' })
    expect(await downscaleImageBlob(blob)).toBe(blob)
  })

  it('returns the original blob when createImageBitmap is unavailable (SSR/test fallback)', async () => {
    // jsdom has no createImageBitmap — the helper must degrade, never throw.
    const blob = new Blob([new Uint8Array(16)], { type: 'image/png' })
    expect(await downscaleImageBlob(blob)).toBe(blob)
  })

  it('downscales an oversized image to <= maxEdge and re-encodes to a smaller blob', async () => {
    const bitmap = { width: 6000, height: 3000, close: vi.fn() }
    const smaller = new Blob([new Uint8Array(100)], { type: 'image/png' })
    const bigger = new Blob([new Uint8Array(10_000)], { type: 'image/png' })

    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    const ctx = { drawImage: vi.fn() }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb: (b: Blob | null) => void) => cb(smaller),
    }
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement)

    const out = await downscaleImageBlob(bigger, { maxEdge: 3000 })

    expect(out).toBe(smaller)
    // 6000 longest edge → scale 0.5 → 3000 × 1500.
    expect(canvas.width).toBe(3000)
    expect(canvas.height).toBe(1500)
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('keeps the original when the re-encode did not actually shrink it', async () => {
    const bitmap = { width: 6000, height: 3000, close: vi.fn() }
    const bigger = new Blob([new Uint8Array(100)], { type: 'image/png' })
    const notSmaller = new Blob([new Uint8Array(10_000)], { type: 'image/png' })

    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void) => cb(notSmaller),
    }
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement)

    const out = await downscaleImageBlob(bigger, { maxEdge: 3000 })
    expect(out).toBe(bigger)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// replaceQcMarkup — order-safe swap (Defect B1)
// ─────────────────────────────────────────────────────────────────────────────

function mockSupabase(opts: { rowError?: string } = {}) {
  const uploads: Array<{ path: string; upsert?: boolean }> = []
  const removes: string[][] = []
  const updatePayloads: Array<Record<string, unknown>> = []

  const upload = vi.fn(async (path: string, _body: Blob, o: { upsert?: boolean }) => {
    uploads.push({ path, upsert: o?.upsert })
    return { data: { path }, error: null }
  })
  const remove = vi.fn(async (paths: string[]) => {
    removes.push([...paths])
    return { data: null, error: null }
  })

  const supabase = {
    storage: { from: vi.fn(() => ({ upload, remove })) },
    schema: () => ({
      from: () => ({
        update: (payload: Record<string, unknown>) => {
          updatePayloads.push(payload)
          return {
            eq: () =>
              Promise.resolve({ error: opts.rowError ? { message: opts.rowError } : null }),
          }
        },
      }),
    }),
  }

  return { supabase, uploads, removes, updatePayloads, upload, remove }
}

describe('replaceQcMarkup — order-safe swap (Defect B1)', () => {
  const PHOTO = { id: 'p-1', filePath: 'org/proj/rep/entry/1700000000000-0.png' }
  const markup = () => ({
    blob: new Blob([new Uint8Array(1024)], { type: 'image/png' }),
    annotationData: { canvas: { w: 10, h: 10 }, shapes: [] } as unknown as SceneGraph,
  })

  it('uploads to a NEW path (upsert:false), repoints the row, then removes the OLD object', async () => {
    const m = mockSupabase()
    const mk = markup()
    await replaceQcMarkup(m.supabase as never, PHOTO, mk)

    // A brand-new object in the same entry folder — never an in-place overwrite.
    expect(m.uploads).toHaveLength(1)
    expect(m.uploads[0].path).not.toBe(PHOTO.filePath)
    expect(m.uploads[0].path.startsWith('org/proj/rep/entry/')).toBe(true)
    expect(m.uploads[0].upsert).toBe(false)

    // Row repointed at the new path (+ fresh scene + size).
    expect(m.updatePayloads[0]).toMatchObject({
      file_path: m.uploads[0].path,
      file_size_bytes: mk.blob.size,
    })
    expect(m.updatePayloads[0].annotation_data).toBe(mk.annotationData)

    // OLD object removed only AFTER the row committed to the new path.
    expect(m.removes).toContainEqual([PHOTO.filePath])
  })

  it('a rejected row update bins the NEW blob and never touches the original', async () => {
    const m = mockSupabase({ rowError: 'closed-report freeze' })
    await expect(replaceQcMarkup(m.supabase as never, PHOTO, markup())).rejects.toThrow(
      /Could not update markup/,
    )

    const newPath = m.uploads[0].path
    expect(m.removes).toContainEqual([newPath]) // new blob cleaned up
    expect(m.removes.some((r) => r.includes(PHOTO.filePath))).toBe(false) // original untouched
  })

  it('a failed re-upload leaves the original object + row completely intact', async () => {
    const m = mockSupabase()
    m.upload.mockResolvedValueOnce({ data: null, error: { message: 'network' } } as never)
    await expect(replaceQcMarkup(m.supabase as never, PHOTO, markup())).rejects.toThrow(
      /Re-upload failed/,
    )
    expect(m.updatePayloads).toHaveLength(0) // never repointed the row
    expect(m.removes).toHaveLength(0) // never removed anything
  })

  it('rejects an oversized markup at the 20 MB cap when downscale cannot shrink it', async () => {
    const m = mockSupabase()
    // No createImageBitmap in jsdom → downscale falls back → cap backstop fires.
    const big = { size: 21 * 1024 * 1024, type: 'image/png' } as unknown as Blob
    await expect(
      replaceQcMarkup(m.supabase as never, PHOTO, {
        blob: big,
        annotationData: {} as unknown as SceneGraph,
      }),
    ).rejects.toThrow(/20 MB/)
    expect(m.uploads).toHaveLength(0)
  })
})
