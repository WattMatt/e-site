/**
 * Site forms — per-board records captured by site electricians on an existing
 * installation (termination and making safe, and any later form types).
 *
 * The form ENGINE is not duplicated here. Sections, fields, conditionals,
 * repeating groups, evaluation and Zod validation all come from
 * `../inspections`, which is generic despite its name and is already shared by
 * web and mobile. This module adds only what is specific to site forms: the
 * submit gates and the template itself.
 *
 * See `docs/superpowers/specs/2026-08-12-site-forms-termination-making-safe-design.md`
 * §4.1 for why the engine is reused in place rather than moved or forked.
 */

export {
  evaluateSubmitGates,
  buildGateInput,
  type GateIssue,
  type GateInput,
  type GateInstrument,
  type GateDefect,
  type GateResponseRow,
} from './gates'

export {
  buildPrefill,
  polesToPhases,
  type PrefillSources,
  type PrefillResponse,
  type PrefillSource,
  type PrefillProject,
  type PrefillOrganisation,
  type PrefillNode,
  type PrefillFeed,
  type PrefillDownstream,
} from './prefill'

export const TERMINATION_AND_MAKING_SAFE_KEY = 'termination-and-making-safe'

/**
 * Signature blocks, pinned to the `field.form_signatures.block_id` CHECK in
 * migration 00179. One block per signature the template actually collects, so
 * no two signature fields share a row — `UNIQUE (form_id, block_id)` means a
 * shared block would let the second signatory silently overwrite the first.
 */
export const SITE_FORM_SIGNATURE_BLOCKS = [
  'electrician',
  'registered_person',
  'supervisor',
  'client_witness',
  'safe_isolation_confirmed',
  'hazard_sweep_technician',
  'hazard_sweep_supervisor',
] as const
export type SiteFormSignatureBlock = (typeof SITE_FORM_SIGNATURE_BLOCKS)[number]

/**
 * Template signature `field_id` → storage `block_id`.
 *
 * The capture UI and the PDF renderer must agree on this map; a mismatch means
 * a signature is captured under one key and rendered from another, i.e. it
 * silently disappears from the issued record.
 */
export const SITE_FORM_SIGNATURE_FIELD_BLOCKS: Record<string, SiteFormSignatureBlock> = {
  safe_isolation_confirmed: 'safe_isolation_confirmed',
  hazard_sweep_technician_signature: 'hazard_sweep_technician',
  hazard_sweep_supervisor_signature: 'hazard_sweep_supervisor',
  electrician_declaration_signature: 'electrician',
  registered_person_declaration_signature: 'registered_person',
  supervisor_signature: 'supervisor',
  client_signature: 'client_witness',
}

/** Lifecycle states, pinned to the `field.site_forms.status` CHECK in 00179. */
export const SITE_FORM_STATUSES = ['draft', 'submitted', 'distributed', 'void'] as const
export type SiteFormStatus = (typeof SITE_FORM_STATUSES)[number]
