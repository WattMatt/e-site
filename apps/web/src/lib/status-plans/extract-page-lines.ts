/**
 * Read one drawing page's straight line work into image space (spec §5), so
 * a detected DB block can snap onto its table's border (snap-blocks.ts).
 *
 * pdf.js 5.7 hands paths over in its operator list as
 *   OPS.constructPath, [paintOp, [Float32Array path | null], minMax | null]
 * where the path is a flat run of DrawOPS (moveTo 0 x y, lineTo 1 x y,
 * curveTo 2 ×6, quadraticCurveTo 3 ×4, closePath 4) in the coordinates of the
 * CURRENT transform. The CTM is tracked here through save / restore /
 * transform and form XObjects (paintFormXObjectBegin carries the form's
 * matrix), then composed with the viewport transform — the same matrix the
 * text reader uses, so /Rotate is matrix maths, never a special case.
 *
 * Only painted, axis-aligned, straight pieces at least MIN_SEGMENT_PX long
 * are kept (most of a schematic is short glyph strokes). Annotation
 * appearances are skipped. Work is capped, and nothing here ever throws: any
 * failure means "no lines", and the boxes then follow the text.
 */
import { composeMatrix, segmentToImageSpace, type LineSegment, type Matrix } from '@esite/shared/status-plans'

/** Shorter pieces are glyph strokes and hatching, never a table border. Image pixels. */
export const MIN_SEGMENT_PX = 3
/** Stop collecting after this many lines. */
export const MAX_LINE_SEGMENTS = 200_000

/** pdf.js DrawOPS (src/shared/util.js) — not exported by the package. */
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const

export type PdfOps = Readonly<Record<string, number>>
export interface OperatorListPage {
  getOperatorList: () => Promise<{ fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }>
}

function asMatrix(v: unknown): Matrix | null {
  if (!v || typeof (v as ArrayLike<number>).length !== 'number' || (v as ArrayLike<number>).length < 6) return null
  const a = v as ArrayLike<number>
  const m = [a[0], a[1], a[2], a[3], a[4], a[5]] as number[]
  return m.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (m as unknown as Matrix) : null
}

export async function extractPageLines(
  page: OperatorListPage,
  viewportTransform: Matrix,
  ops: PdfOps | undefined,
  opts: { maxSegments?: number } = {},
): Promise<LineSegment[]> {
  const max = opts.maxSegments ?? MAX_LINE_SEGMENTS
  const out: LineSegment[] = []
  if (!ops || typeof ops.constructPath !== 'number') return out
  try {
    const { fnArray, argsArray } = await page.getOperatorList()
    const painted = new Set(
      ['stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke']
        .map((k) => ops[k])
        .filter((n): n is number => typeof n === 'number'),
    )
    let ctm: Matrix = viewportTransform
    const stack: Matrix[] = []
    let inAnnotation = 0

    const push = (x1: number, y1: number, x2: number, y2: number) => {
      const s = segmentToImageSpace(x1, y1, x2, y2, ctm)
      if (s && s.to - s.from >= MIN_SEGMENT_PX) out.push(s)
    }

    for (let i = 0; i < fnArray.length && out.length < max; i++) {
      const fn = fnArray[i]
      const args = argsArray[i] as unknown[] | null | undefined
      if (fn === ops.beginAnnotation) { inAnnotation++; continue }
      if (fn === ops.endAnnotation) { inAnnotation = Math.max(0, inAnnotation - 1); continue }
      if (inAnnotation > 0) continue
      if (fn === ops.save) { stack.push(ctm); continue }
      if (fn === ops.restore) { ctm = stack.pop() ?? ctm; continue }
      if (fn === ops.transform) {
        const m = asMatrix(args)
        if (m) ctm = composeMatrix(ctm, m)
        continue
      }
      if (fn === ops.paintFormXObjectBegin) {
        stack.push(ctm)
        const m = asMatrix(args?.[0])
        if (m) ctm = composeMatrix(ctm, m)
        continue
      }
      if (fn === ops.paintFormXObjectEnd) { ctm = stack.pop() ?? ctm; continue }
      if (fn !== ops.constructPath || !Array.isArray(args)) continue
      if (!painted.has(args[0] as number)) continue
      const holder = args[1] as unknown[] | undefined
      const buf = Array.isArray(holder) ? (holder[0] as ArrayLike<number> | null) : null
      if (!buf || typeof buf.length !== 'number') continue

      let cx = 0, cy = 0, sx = 0, sy = 0
      for (let k = 0; k < buf.length && out.length < max;) {
        switch (buf[k++]) {
          case DRAW.moveTo:
            cx = sx = buf[k++]!
            cy = sy = buf[k++]!
            break
          case DRAW.lineTo: {
            const x = buf[k++]!, y = buf[k++]!
            push(cx, cy, x, y)
            cx = x; cy = y
            break
          }
          case DRAW.curveTo:
            k += 4
            cx = buf[k++]!; cy = buf[k++]!
            break
          case DRAW.quadraticCurveTo:
            k += 2
            cx = buf[k++]!; cy = buf[k++]!
            break
          case DRAW.closePath:
            push(cx, cy, sx, sy)
            cx = sx; cy = sy
            break
          default:
            k = buf.length // unknown op: the rest of this path cannot be read
        }
      }
    }
    return out
  } catch {
    return []
  }
}
