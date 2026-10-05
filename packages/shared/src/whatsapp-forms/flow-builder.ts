/**
 * Inspection template → WhatsApp Flow JSON (endpoint-less, navigate + complete).
 *
 * One screen per section. Every input value is read on the terminal screen through
 * the global `${screen.<ID>.form.<name>}` binding (Flow JSON ≥ 4.0), so screens carry
 * no data declarations and the completion payload names every input exactly once.
 *
 * Input names are DERIVED from template order (`s<screen>_f<field>`), never from field
 * ids, and `flowFieldKeys()` is the single source both the builder and the reply
 * mapper read. A published Flow and the mapper therefore cannot drift for the same
 * template row — and template rows are immutable (enforce_template_immutability).
 *
 * Limits are Meta's published component limits (Flows "Components" guide, read
 * 2026-10-05). A label longer than its component allows is shortened, and the full
 * question is shown in a TextBody above the input, so nothing is lost.
 *
 * Fields the Flow does not ask:
 *  - photo     → sent as chat photos ("photo for item N")
 *  - signature → signed on the web through a signed link
 *  - file (optional only) → not collected over WhatsApp
 *  - header    → shown as a sub-heading; computed → never captured
 */
import type { Field, Template } from '../inspections/types'

export const FLOW_JSON_VERSION = '7.3'

export const FLOW_LIMITS = {
  componentsPerScreen: 50,
  screenTitle: 30,
  textBody: 4096,
  subheading: 80,
  helperText: 80,
  optionTitle: 30,
  radioOptions: { min: 1, max: 20 },
  dropdownOptions: { min: 1, max: 200 },
  label: {
    TextInput: 20,
    TextArea: 20,
    Dropdown: 20,
    RadioButtonsGroup: 30,
    CheckboxGroup: 30,
    DatePicker: 40,
    Footer: 35,
  },
} as const

export const PASS_FAIL_OPTIONS = [
  { id: 'pass', title: 'Pass' },
  { id: 'fail', title: 'Fail' },
  { id: 'na', title: 'N/A' },
] as const

const FAIL_REASON_LABEL = 'Reason if Fail'
const SCREEN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export type FlowKeyRole = 'value' | 'fail_reason'

export interface FlowFieldKey {
  key: string
  screenId: string
  sectionId: string
  fieldId: string
  role: FlowKeyRole
  field: Field
}

export interface FieldRef {
  sectionId: string
  fieldId: string
  label: string
  required: boolean
}

export interface FlowCapability {
  ok: boolean
  reasons: string[]
  photoFields: FieldRef[]
  signatureFields: FieldRef[]
  /** Optional fields WhatsApp does not collect (non-required file uploads). */
  skippedFields: FieldRef[]
}

/** Field types that become a Flow input. */
const INPUT_TYPES = new Set(['pass_fail', 'number', 'text', 'textarea', 'dropdown', 'multi_select', 'date'])

export function fit(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

function fullQuestion(f: Field): string {
  return f.unit ? `${f.label} (${f.unit})` : f.label
}

export function humaniseToken(token: string): string {
  const s = token.replace(/_/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function ref(sectionId: string, f: Field): FieldRef {
  return { sectionId, fieldId: f.field_id, label: f.label, required: !!f.required }
}

/** Sections that produce a screen (at least one Flow input), in template order. */
function screenSections(t: Template) {
  return t.sections.filter((s) => (s.fields ?? []).some((f) => INPUT_TYPES.has(f.type)))
}

/** Component count for one field, matching what buildInspectionFlow emits. */
function componentCount(f: Field): number {
  if (f.type === 'header') return 1
  if (!INPUT_TYPES.has(f.type)) return 0
  const comp = componentFor(f)
  const lim = FLOW_LIMITS.label[comp]
  const body = fullQuestion(f).length > lim ? 1 : 0
  return body + 1 + (f.type === 'pass_fail' ? 1 : 0)
}

function componentFor(f: Field): keyof typeof FLOW_LIMITS.label {
  switch (f.type) {
    case 'pass_fail': return 'RadioButtonsGroup'
    case 'dropdown': return 'Dropdown'
    case 'multi_select': return 'CheckboxGroup'
    case 'date': return 'DatePicker'
    case 'textarea': return 'TextArea'
    default: return 'TextInput'
  }
}

export function flowCapability(t: Template): FlowCapability {
  const reasons: string[] = []
  const photoFields: FieldRef[] = []
  const signatureFields: FieldRef[] = []
  const skippedFields: FieldRef[] = []

  for (const s of t.sections) {
    if (s.conditional_on) reasons.push(`section "${s.section_id}" is conditional`)
    if (!String(s.title ?? '').trim() && (s.fields ?? []).some((f) => INPUT_TYPES.has(f.type))) {
      reasons.push(`section "${s.section_id}" has a blank title`)
    }
    const seen = new Set<string>()
    if (s.subsections && s.subsections.length > 0) reasons.push(`section "${s.section_id}" has subsections`)
    let count = 1 // Footer
    for (const f of s.fields ?? []) {
      if (f.conditional_on) reasons.push(`field "${f.field_id}" is conditional`)
      if (seen.has(f.field_id)) reasons.push(`duplicate field "${f.field_id}" in section "${s.section_id}"`)
      seen.add(f.field_id)
      if ((INPUT_TYPES.has(f.type) || f.type === 'header') && !String(f.label ?? '').trim()) {
        reasons.push(`field "${f.field_id}" has a blank label`)
      }
      if (f.type === 'dropdown' || f.type === 'multi_select') {
        const opts = f.options ?? []
        if (opts.some((o) => !String(o ?? '').trim())) reasons.push(`field "${f.field_id}" has a blank option`)
        if (new Set(opts).size !== opts.length) reasons.push(`field "${f.field_id}" has a duplicate option`)
      }
      if (f.type === 'repeating_group') reasons.push(`repeating group "${f.field_id}" is a table`)
      if (f.type === 'file') {
        if (f.required) reasons.push(`required file "${f.field_id}" cannot be sent over WhatsApp`)
        else skippedFields.push(ref(s.section_id, f))
      }
      if (f.type === 'photo') photoFields.push(ref(s.section_id, f))
      if (f.type === 'signature') signatureFields.push(ref(s.section_id, f))
      if (f.type === 'dropdown' || f.type === 'multi_select') {
        const n = (f.options ?? []).length
        const lim = f.type === 'dropdown' ? FLOW_LIMITS.dropdownOptions : FLOW_LIMITS.radioOptions
        if (n < lim.min || n > lim.max) reasons.push(`field "${f.field_id}" has ${n} options (allowed ${lim.min}–${lim.max})`)
      }
      count += componentCount(f)
    }
    if (count > FLOW_LIMITS.componentsPerScreen) {
      reasons.push(`section "${s.section_id}" needs ${count} components (Meta allows 50 components per screen)`)
    }
  }
  const screens = screenSections(t).length
  if (screens === 0) reasons.push('template has no questions a Flow can ask')
  if (screens > SCREEN_LETTERS.length) reasons.push(`template has ${screens} sections (at most ${SCREEN_LETTERS.length})`)

  return { ok: reasons.length === 0, reasons, photoFields, signatureFields, skippedFields }
}

/** Every Flow input the builder emits, with its derived name. Template order. */
export function flowFieldKeys(t: Template): FlowFieldKey[] {
  const keys: FlowFieldKey[] = []
  screenSections(t).forEach((s, si) => {
    const screenId = `SECTION_${SCREEN_LETTERS[si]}`
    ;(s.fields ?? []).forEach((f, fi) => {
      if (!INPUT_TYPES.has(f.type)) return
      const key = `s${si}_f${fi}`
      keys.push({ key, screenId, sectionId: s.section_id, fieldId: f.field_id, role: 'value', field: f })
      if (f.type === 'pass_fail') {
        keys.push({ key: `${key}_r`, screenId, sectionId: s.section_id, fieldId: f.field_id, role: 'fail_reason', field: f })
      }
    })
  })
  return keys
}

type Component = Record<string, unknown> & { type: string }

export interface FlowScreen {
  id: string
  title: string
  terminal?: boolean
  success?: boolean
  layout: { type: 'SingleColumnLayout'; children: Component[] }
}

export interface FlowJson {
  version: string
  screens: FlowScreen[]
}

function inputComponents(f: Field, key: string): Component[] {
  const comp = componentFor(f)
  const lim = FLOW_LIMITS.label[comp]
  const q = fullQuestion(f)
  const out: Component[] = []
  if (q.length > lim) out.push({ type: 'TextBody', text: fit(q, FLOW_LIMITS.textBody) })
  const base: Component = { type: comp, name: key, label: fit(q, lim), required: !!f.required }
  const help = f.help_text ? fit(f.help_text, FLOW_LIMITS.helperText) : ''
  const withHelp = (c: Component) => (help && (comp === 'TextInput' || comp === 'TextArea' || comp === 'DatePicker') ? { ...c, 'helper-text': help } : c)
  const options = (f.options ?? []).map((o) => ({ id: o, title: fit(humaniseToken(o), FLOW_LIMITS.optionTitle) }))

  switch (f.type) {
    case 'pass_fail':
      out.push({ ...base, 'data-source': PASS_FAIL_OPTIONS.map((o) => ({ ...o })) })
      out.push({ type: 'TextInput', name: `${key}_r`, label: FAIL_REASON_LABEL, 'input-type': 'text', required: false })
      break
    case 'number':
      out.push(withHelp({ ...base, 'input-type': 'number' }))
      break
    case 'text':
      out.push(withHelp({ ...base, 'input-type': 'text' }))
      break
    case 'textarea':
      out.push(withHelp(base))
      break
    case 'date':
      out.push(withHelp(base))
      break
    case 'dropdown':
    case 'multi_select':
      out.push({ ...base, 'data-source': options })
      break
  }
  return out
}

export function buildInspectionFlow(t: Template): FlowJson {
  const cap = flowCapability(t)
  if (!cap.ok) throw new Error(`Template "${t.template_id}" cannot be a Flow: ${cap.reasons.join('; ')}`)

  const keys = flowFieldKeys(t)
  const sections = screenSections(t)
  const screens: FlowScreen[] = sections.map((s, si) => {
    const id = `SECTION_${SCREEN_LETTERS[si]}`
    const last = si === sections.length - 1
    const children: Component[] = []
    ;(s.fields ?? []).forEach((f, fi) => {
      if (f.type === 'header') children.push({ type: 'TextSubheading', text: fit(f.label, FLOW_LIMITS.subheading) })
      else if (INPUT_TYPES.has(f.type)) children.push(...inputComponents(f, `s${si}_f${fi}`))
    })
    const action = last
      ? { name: 'complete', payload: Object.fromEntries(keys.map((k) => [k.key, `\${screen.${k.screenId}.form.${k.key}}`])) }
      : { name: 'navigate', next: { type: 'screen', name: `SECTION_${SCREEN_LETTERS[si + 1]}` }, payload: {} }
    children.push({ type: 'Footer', label: last ? 'Save answers' : 'Next', 'on-click-action': action })
    return {
      id,
      title: fit(s.title, FLOW_LIMITS.screenTitle),
      ...(last ? { terminal: true, success: true } : {}),
      layout: { type: 'SingleColumnLayout', children },
    }
  })
  return { version: FLOW_JSON_VERSION, screens }
}
