/**
 * Pure editor-state rules for the Layout workspace (functional spec §6.1–§6.3),
 * kept out of the component so they are unit-tested (the component itself is
 * Konva-bound and untested, like RouteCanvas).
 */
import { applyObjectDelta, diffObjects, normaliseReferences, type LayoutObject, type LayoutObjectKind, type ModuleRef } from '@esite/shared'

/** Same shape as SolarCanvas's Selection (kept here so lib does not depend on an app route). */
export interface Selection { ids: string[]; modules: ModuleRef[] }

/** `base` = the saved object list the draft's edits were made against (absent on drafts written before it existed). */
export type LayoutDraft = { objects: LayoutObject[]; base?: LayoutObject[]; basedOn: string; savedAt: string }

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

/** "<name> (copy)", then "(copy 2)", … — layout names are unique per study, case-insensitively (00212). */
export function uniqueCopyName(name: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()))
  const base = name.trim()
  if (!taken.has(`${base} (copy)`.toLowerCase())) return `${base} (copy)`
  for (let i = 2; ; i++) {
    const c = `${base} (copy ${i})`
    if (!taken.has(c.toLowerCase())) return c
  }
}

export const STALE_DRAFT_MESSAGE =
  'Someone else changed this layout after these edits were made, so they cannot be merged safely. Discard them, or note them and redo them on the current layout.'

/**
 * The object list a Restore produces — or a refusal.
 *
 * The draft's own edits (base → objects) are replayed only onto a layout that
 * has NOT otherwise changed since the draft's base (e.g. the save was stale
 * because of a rename or a north change). If anyone changed the objects, a
 * merge is refused: object-level merging cannot keep string references honest
 * (module indices renumber when modules are deleted on either side), and a
 * plausible-looking wrong string assignment is worse than asking the user to
 * redo their edits. A legacy draft without a base is replayed only when it
 * was made on the current version.
 */
export function restoreDraft(
  draft: LayoutDraft, serverObjects: LayoutObject[], serverUpdatedAt?: string,
): { ok: true; objects: LayoutObject[] } | { ok: false; error: string } {
  if (!draft.base) {
    return serverUpdatedAt === undefined || draft.basedOn === serverUpdatedAt
      ? { ok: true, objects: normaliseReferences(draft.objects) }
      : { ok: false, error: STALE_DRAFT_MESSAGE }
  }
  const moved = diffObjects(draft.base, serverObjects)
  if (moved.upserts.length + moved.deletes.length > 0) return { ok: false, error: STALE_DRAFT_MESSAGE }
  const d = diffObjects(draft.base, draft.objects)
  return { ok: true, objects: normaliseReferences(applyObjectDelta(serverObjects, d.upserts, d.deletes, null)) }
}

/** An exported sheet must show every layer its legend and summary count; null when nothing is hidden. */
export function exportBlockedBy(hidden: ReadonlySet<string>): string | null {
  const names = LAYERS.filter((l) => hidden.has(l.key)).map((l) => l.label)
  return names.length ? `Show every layer before exporting the sheet (hidden: ${names.join(', ')}).` : null
}

/** Keep only what is still visible selected, so a hidden object cannot be moved, rotated or deleted unseen. */
export function pruneSelection(sel: Selection, visible: LayoutObject[]): Selection {
  const ids = new Set(visible.map((o) => o.id))
  return { ids: sel.ids.filter((id) => ids.has(id)), modules: sel.modules.filter((m) => ids.has(m.arrayId)) }
}
