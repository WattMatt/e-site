/**
 * Reads a COPIED page's /Annots (already inside the output document, copied with the
 * donor page by render-plan-page.ts) into the appearance streams to paint and the §12.5.5
 * matrix for each. The rules are annotation-appearance.ts's; this file only reads pdf-lib
 * objects. A malformed annotation is skipped, never thrown on: a markup must not cost the
 * whole sheet.
 */
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, PDFStream, type PDFContext } from 'pdf-lib'
import {
  IDENTITY, annotationDrawn, appearanceMatrix, pickAppearance,
  type ApNormal, type Mat, type Quad,
} from './annotation-appearance'

export interface FlatAppearance {
  /** The appearance stream (a form XObject) in the output document. */
  ref: PDFRef
  /** §12.5.5 matrix A, in the source page's user space. */
  matrix: Mat
}

const N = (s: string) => PDFName.of(s)

function numbers(arr: PDFArray | undefined, len: number): number[] | null {
  if (!arr || arr.size() !== len) return null
  const out: number[] = []
  for (let i = 0; i < len; i++) {
    const v = arr.lookup(i)
    if (!(v instanceof PDFNumber)) return null
    out.push(v.asNumber())
  }
  return out.every(Number.isFinite) ? out : null
}

/** A stream, by reference; a direct stream object is registered so it can be named from a page. */
function streamRef(ctx: PDFContext, raw: unknown): PDFRef | null {
  if (raw instanceof PDFRef) return ctx.lookup(raw) instanceof PDFStream ? raw : null
  if (raw instanceof PDFStream) return ctx.register(raw)
  return null
}

function normalAppearance(ctx: PDFContext, ap: PDFDict | undefined): ApNormal<PDFRef> {
  if (!ap) return null
  const raw = ap.get(N('N'))
  if (!raw) return null
  const resolved = raw instanceof PDFRef ? ctx.lookup(raw) : raw
  if (resolved instanceof PDFStream) {
    const ref = streamRef(ctx, raw)
    return ref ? { kind: 'stream', stream: ref } : null
  }
  if (resolved instanceof PDFDict) {
    const states = new Map<string, PDFRef>()
    for (const [key, value] of resolved.entries()) {
      const ref = streamRef(ctx, value)
      if (ref) states.set(key.decodeText(), ref)
    }
    return { kind: 'states', states }
  }
  return null
}

export function collectAnnotationAppearances(ctx: PDFContext, page: PDFDict): FlatAppearance[] {
  let annots: PDFArray | undefined
  try {
    annots = page.lookupMaybe(N('Annots'), PDFArray)
  } catch {
    return []
  }
  if (!annots) return []
  const out: FlatAppearance[] = []
  for (let i = 0; i < annots.size(); i++) {
    try {
      const a = annots.lookup(i)
      if (!(a instanceof PDFDict)) continue
      const subtype = a.lookupMaybe(N('Subtype'), PDFName)?.decodeText() ?? null
      const flags = a.lookupMaybe(N('F'), PDFNumber)?.asNumber() ?? 0
      if (!annotationDrawn(subtype, flags)) continue
      const rect = numbers(a.lookupMaybe(N('Rect'), PDFArray), 4)
      if (!rect) continue
      const as = a.lookupMaybe(N('AS'), PDFName)?.decodeText() ?? null
      const ref = pickAppearance(normalAppearance(ctx, a.lookupMaybe(N('AP'), PDFDict)), as)
      if (!ref) continue
      const stream = ctx.lookup(ref)
      if (!(stream instanceof PDFStream)) continue
      const bbox = numbers(stream.dict.lookupMaybe(N('BBox'), PDFArray), 4)
      if (!bbox) continue
      const m = numbers(stream.dict.lookupMaybe(N('Matrix'), PDFArray), 6) ?? [...IDENTITY]
      // An appearance stream IS a form XObject (§12.5.5); some writers omit the names.
      if (!stream.dict.has(N('Subtype'))) stream.dict.set(N('Subtype'), N('Form'))
      if (!stream.dict.has(N('Type'))) stream.dict.set(N('Type'), N('XObject'))
      out.push({ ref, matrix: appearanceMatrix(rect as unknown as Quad, bbox as unknown as Quad, m as unknown as Mat) })
    } catch {
      continue
    }
  }
  return out
}
