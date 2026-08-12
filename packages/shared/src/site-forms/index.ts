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

export const TERMINATION_AND_MAKING_SAFE_KEY = 'termination-and-making-safe'

/** Signature blocks on the termination & making-safe form, pinned to the DB CHECK. */
export const SITE_FORM_SIGNATURE_BLOCKS = [
  'electrician',
  'registered_person',
  'supervisor',
  'client_witness',
] as const
export type SiteFormSignatureBlock = (typeof SITE_FORM_SIGNATURE_BLOCKS)[number]

/** Lifecycle states, pinned to the `field.site_forms.status` CHECK in 00179. */
export const SITE_FORM_STATUSES = ['draft', 'submitted', 'distributed', 'void'] as const
export type SiteFormStatus = (typeof SITE_FORM_STATUSES)[number]
