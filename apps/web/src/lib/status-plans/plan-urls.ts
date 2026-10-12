/** Routes and drawing-type checks for status plans. Pure; safe on client and server. */

export const isPdfPath = (p: string): boolean => /\.pdf$/i.test(p)
export const isImagePath = (p: string): boolean => /\.(png|jpe?g|webp|svg)$/i.test(p)
/** The canvas renders PDFs (via pdfjs) and rasters; DWG and friends are not drawable. */
export const isRenderableDrawing = (p: string): boolean => isPdfPath(p) || isImagePath(p)

export function statusPlansHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/status-plans`
}

/** A plan, optionally with one shape selected (`?shape=` — the tenant schedule's "On plan" link). */
export function statusPlanHref(projectId: string, planId: string, shapeId?: string | null): string {
  const base = `${statusPlansHref(projectId)}/${encodeURIComponent(planId)}`
  return shapeId ? `${base}?shape=${encodeURIComponent(shapeId)}` : base
}

/** "643-E-300 rev B.pdf" from a storage path, for the drawing-changed banner. */
export function fileLabel(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}
