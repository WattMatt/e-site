// The source modules that own an edit the spine cannot keep. See
// work-items.actions.ts for the actions that enforce this, and migration
// 00199 section D for the forward reads that make it necessary.

/**
 * Edits the SOURCE MODULE owns, and the sentence that says so.
 *
 * Migration 00199's projection triggers FORWARD-READ the source's own columns
 * on EVERY projection, so a spine-side edit of one of these is not refused by
 * the database — it is silently reverted by the next source write. Measured:
 *
 *   - `inspection` people. The mirror re-reads inspections.assigned_to_id and
 *     verifier_id every time it projects, so a PM's reassignment or gatekeeper
 *     correction is undone by an unrelated title edit — or by the inspector
 *     merely pressing start (assigned → in_progress). 00066's assignment flow
 *     and the certification chain own those columns; the spine follows them.
 *   - `qc_defect` priority. The mirror files priority from qc_entries.severity
 *     while that is non-NULL, so an owner's re-file lasts until the next
 *     watched source write.
 *
 * Refusing with a sentence that names WHERE the edit belongs is option (a) of
 * three. Option (b) — write the spine's answer back to the source — was
 * rejected: the Inspections module owns verifier_id (certification chain).
 * Option (c) — the projection wrapper passes a "the source's people column
 * actually changed" flag and the forward read runs only then — is the durable
 * fix and is recorded for a later quarter.
 *
 * This is NOT a security boundary. Over direct PostgREST a write-role holder
 * can still make the edit; it will simply not survive. The refusal exists so
 * the product does not offer a control that undoes itself.
 *
 * `priority` has no verb in Q1 — item 2 shipped five (create, reassign,
 * advance, due date, void) and none of them writes priority on an existing
 * item. The sentence is exported rather than inlined so the Inbox's priority
 * control (§04, items 5/6) has exactly one copy of it to call, and cannot
 * re-invent the wording.
 */
const MODULE_OWNED_EDITS: ReadonlyArray<{
  itemType: string
  field: ModuleOwnedField
  sentence: string
}> = [
  {
    itemType: 'inspection',
    field: 'people',
    sentence:
      'Inspections are assigned from the Inspections module — change the inspector or verifier there.',
  },
  {
    itemType: 'qc_defect',
    field: 'priority',
    sentence:
      "A QC defect's priority follows its severity in the QC report — change the severity there.",
  },
]

/** `people` covers BOTH person columns — assignee while triage/open, gatekeeper
 *  while answered — because the mirror forward-reads both. */
export type ModuleOwnedField = 'people' | 'priority'

/**
 * The refusal sentence for a module-owned edit, or null when the spine owns it.
 *
 * This lives OUTSIDE the `'use server'` action module deliberately. Exported
 * from there it would be a POST-able server action that takes two strings and
 * returns a constant — an endpoint with no purpose, which `docs/rbac-matrix.md`
 * would then have to carry a row for. Here it is an ordinary synchronous
 * function, so the Inbox's reassign and priority controls (items 5/6) disable
 * themselves with the same words the action refuses with, and do it without a
 * network round-trip.
 */
export function moduleOwnedRefusal(itemType: string, field: ModuleOwnedField): string | null {
  return MODULE_OWNED_EDITS.find((e) => e.itemType === itemType && e.field === field)?.sentence ?? null
}
