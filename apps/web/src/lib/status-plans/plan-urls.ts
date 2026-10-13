/** Routes and file helpers for tenant plans. Pure; safe on client and server. */
import type { StatusPlanPurpose } from '@esite/shared/status-plans'
import type { ColourBy } from './types'

export const isPdfPath = (p: string): boolean => /\.pdf$/i.test(p)

/** The route segment of each tool under /projects/[id]/tenant-schedule. */
export const TENANT_PLAN_SEGMENT: Record<StatusPlanPurpose, 'floor-plan' | 'line-diagram'> = {
  tenant_layout: 'floor-plan',
  distribution_schematic: 'line-diagram',
}

export function tenantScheduleHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/tenant-schedule`
}

/** A tenant plan, optionally on one sheet, with one shape selected, and in board mode (?sheet= &shape= &colour=board). */
export function tenantPlanHref(
  projectId: string,
  purpose: StatusPlanPurpose,
  opts: { sheet?: string | null; shape?: string | null; colour?: ColourBy | null } = {},
): string {
  const base = `${tenantScheduleHref(projectId)}/${TENANT_PLAN_SEGMENT[purpose]}`
  const q = new URLSearchParams()
  if (opts.sheet) q.set('sheet', opts.sheet)
  if (opts.shape) q.set('shape', opts.shape)
  if (opts.colour === 'board') q.set('colour', 'board')
  const s = q.toString().replace(/\+/g, '%20')
  return s ? `${base}?${s}` : base
}

/** ?colour=board → board mode; anything else (absent, misspelt) → status. */
export function parseColourBy(v: string | null | undefined): ColourBy {
  return v === 'board' ? 'board' : 'status'
}

/** "2.pdf" from a storage path. */
export function fileLabel(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}
