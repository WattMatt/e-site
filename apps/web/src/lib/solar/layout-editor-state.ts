/**
 * Pure editor-state rules for the Layout workspace (functional spec §6.1–§6.3),
 * kept out of the component so they are unit-tested (the component itself is
 * Konva-bound and untested, like RouteCanvas).
 */
import { diffObjects, type LayoutObject, type LayoutObjectKind } from '@esite/shared'

export type LayoutDraft = { objects: LayoutObject[]; basedOn: string; savedAt: string }

/**
 * Fold a save's result into the editor. `sent` is the object list the save was
 * computed from; `present` is whatever the user has now (they may have kept
 * drawing during the round trip). The database-stamped scales are applied to
 * the CURRENT objects, and only what was actually sent becomes "saved" — so an
 * edit made mid-save stays and stays dirty.
 */
export function applySaveResult(
  sent: LayoutObject[], present: LayoutObject[], ppm: Record<string, number | null>,
): { saved: LayoutObject[]; present: LayoutObject[] } {
  const stamp = (o: LayoutObject): LayoutObject => (o.id in ppm ? ({ ...o, pixelsPerMeter: ppm[o.id] ?? null } as LayoutObject) : o)
  return { saved: sent.map(stamp), present: present.map(stamp) }
}

/**
 * Whether to offer a stored draft back. A draft of the current server version
 * is offered as-is; a draft of an OLDER version (e.g. after a stale-save
 * refusal and a reload) is still offered, flagged `stale`, so unsaved work is
 * never silently dropped.
 */
export function draftOffer(
  draft: LayoutDraft | null, serverUpdatedAt: string, serverObjects: LayoutObject[],
): { draft: LayoutDraft; stale: boolean } | null {
  if (!draft || !Array.isArray(draft.objects)) return null
  const d = diffObjects(serverObjects, draft.objects)
  if (d.upserts.length + d.deletes.length === 0) return null
  return { draft, stale: draft.basedOn !== serverUpdatedAt }
}

/** The layer panel (spec §6.1 "layer panel"): each drawn kind belongs to exactly one layer. */
export const LAYERS: ReadonlyArray<{ key: string; label: string; kinds: readonly LayoutObjectKind[] }> = [
  { key: 'roofs', label: 'Roofs', kinds: ['roof'] },
  { key: 'obstructions', label: 'Obstructions', kinds: ['obstruction'] },
  { key: 'arrays', label: 'Arrays', kinds: ['array', 'module_block'] },
  { key: 'strings', label: 'Strings', kinds: ['string'] },
  { key: 'equipment', label: 'Inverters & equipment', kinds: ['inverter', 'equipment'] },
]

export function visibleObjects(objects: LayoutObject[], hidden: ReadonlySet<string>): LayoutObject[] {
  if (hidden.size === 0) return objects
  const hiddenKinds = new Set(LAYERS.filter((l) => hidden.has(l.key)).flatMap((l) => l.kinds))
  return objects.filter((o) => !hiddenKinds.has(o.kind))
}

/** "<name> (copy)", then "(copy 2)", … — layout names are unique per study, case-insensitively (00211). */
export function uniqueCopyName(name: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()))
  const base = name.trim()
  if (!taken.has(`${base} (copy)`.toLowerCase())) return `${base} (copy)`
  for (let i = 2; ; i++) {
    const c = `${base} (copy ${i})`
    if (!taken.has(c.toLowerCase())) return c
  }
}
