/**
 * Drop every indirect object nothing in the document reaches, before save().
 *
 * Why it exists: pdf-lib's embedPage / embedPdf COPIES the donor page (content streams, annotations
 * and their appearance streams) into the target document, then builds the form XObject from a fresh
 * re-encoded copy of the decoded content. The copied page is never referenced again, but it stays
 * registered in the context and save() writes it anyway — so every embedded drawing page was written
 * TWICE (measured 2026-10-09: a 278 KB drawing → 558 KB one-page sheet; 1.06x after this prune).
 *
 * Reachability starts from the trailer (Root, Info, Encrypt, ID). flush() first, so the objects
 * pdf-lib embeds lazily (fonts, images, embedded pages) exist and are walked; save() flushes again,
 * which is a no-op for anything already embedded. Call it as the last step before save(), after
 * every page has been drawn. Returns the number of objects removed.
 */
import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFDocument, type PDFObject } from 'pdf-lib'

export async function pruneUnreachableObjects(doc: PDFDocument): Promise<number> {
  await doc.flush()
  const ctx = doc.context
  const reachable = new Set<PDFRef>() // PDFRef.of interns refs, so identity is safe
  const stack: PDFObject[] = []
  const t = ctx.trailerInfo
  for (const v of [t.Root, t.Info, t.Encrypt, t.ID]) if (v) stack.push(v)
  while (stack.length > 0) {
    const o = stack.pop()!
    if (o instanceof PDFRef) {
      if (reachable.has(o)) continue
      reachable.add(o)
      const target = ctx.lookup(o)
      if (target) stack.push(target)
    } else if (o instanceof PDFStream) {
      stack.push(o.dict)
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v)
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) stack.push(o.get(i))
    }
  }
  let removed = 0
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reachable.has(ref)) { ctx.delete(ref); removed++ }
  }
  return removed
}
