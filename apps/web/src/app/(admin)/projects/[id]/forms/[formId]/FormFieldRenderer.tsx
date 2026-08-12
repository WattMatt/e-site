'use client'

import { useEffect, useRef, useState } from 'react'
import {
  asLeftStatusLabel,
  buildRepeatingGroupKey,
  isFieldVisible,
  listRepeatingGroupEntryIndices,
  parseRepeatingGroupKey,
  type Field,
  type Response as FormResponse,
} from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import FormPhotoStrip, { type FormPhotoRow } from './FormPhotoStrip'
import SignaturePad, {
  SIGNATURE_BLOCK_LABELS,
  aliasBlockForSignatureField,
  blockForSignatureField,
  type FormSignatureRow,
} from './SignaturePad'
import { SITE_FORM_PHOTO_BUCKET } from '@/lib/site-forms/upload'

/**
 * Renders one template field of a site form.
 *
 * Deliberately self-contained: the inspections `FieldRenderer` and its
 * `fields/*` widgets hardcode the `inspections` schema, the `inspection-photos`
 * bucket and an `inspection_id` column, and parameterising them would mean
 * editing a live production module.
 */

export interface FormRendererProps {
  field: Field
  sectionId: string
  response?: FormResponse
  /** Every response on the form — conditionals and repeating groups read it. */
  allResponses: FormResponse[]
  projectId: string
  formId: string
  currentUserId: string | null
  /** Every photo on the form; filtered to this field internally. */
  photos: FormPhotoRow[]
  /** Every signature on the form. */
  signatures: FormSignatureRow[]
  readOnly: boolean
  /** Section 6 sequencing: answerable only once the preceding step is answered. */
  locked?: boolean
  lockNote?: string | null
  /** Autosave state keyed `${sectionId}:${fieldId}` — repeating-group sub-fields
   *  get their own indicator through their synthetic id. */
  savingKeys?: ReadonlySet<string>
  savedKeys?: ReadonlySet<string>
  onChange: (patch: Partial<FormResponse>) => void
  /** Write under an explicit (usually synthetic) field id. */
  onUpsert: (fieldId: string, patch: Partial<FormResponse>) => void
  onPhotoAdded: (row: FormPhotoRow) => void
  onPhotoRemoved: (id: string) => void
  onSignatureSaved: (row: FormSignatureRow) => void
  /** A repeating-group entry was deleted; drop its responses and photos. */
  onEntryRemoved: (fieldIds: string[], photoIds: string[]) => void
}

type PgError = { message: string } | null

interface Filter<T> extends PromiseLike<{ data: T[] | null; error: PgError }> {
  eq(column: string, value: string): Filter<T>
  in(column: string, values: string[]): Filter<T>
}

interface EntryDbClient {
  schema(name: string): {
    from(table: string): {
      select(columns: string): Filter<{ id: string; storage_path: string }>
      delete(): Filter<never>
    }
  }
}

// ─── Option + value presentation ─────────────────────────────────────────────

/**
 * Option tokens are stored snake_case so the PDF, the gates and the DB all
 * agree on one machine value. Only tokens that sentence-case badly are mapped
 * explicitly; everything else falls through to the generic prettifier.
 */
const OPTION_LABELS: Record<string, string> = {
  tn_s: 'TN-S',
  tn_c_s: 'TN-C-S',
  tn_c: 'TN-C',
  tt: 'TT',
  it: 'IT',
  '230_v': '230 V',
  '400_v': '400 V',
  '525_v': '525 V',
  cat_ii: 'CAT II',
  cat_iii: 'CAT III',
  cat_iv: 'CAT IV',
  mcb: 'MCB',
  mccb: 'MCCB',
  rcbo: 'RCBO',
  rcd_or_elu: 'RCD / ELU',
  ups: 'UPS',
  pv_or_inverter: 'PV or inverter',
  swa: 'SWA',
  ecc: 'ECC',
  pvc_in_conduit: 'PVC in conduit',
  C1: 'C1 — immediate danger',
  C2: 'C2 — potentially dangerous',
  C3: 'C3 — improvement recommended',
  FI: 'FI — further investigation',
}

export function optionLabel(fieldId: string, token: string): string {
  if (fieldId === 'as_left_status') return asLeftStatusLabel(token)
  if (OPTION_LABELS[token]) return OPTION_LABELS[token]
  // Pure numbers (phase counts, pole counts, core counts) stay verbatim.
  if (/^[0-9]+(\+N)?$/i.test(token)) return token
  const spaced = token.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// ─── Derived (computed) fields ───────────────────────────────────────────────

/** Circuit actions that leave a circuit in a temporary or isolated state. */
const TEMPORARY_CIRCUIT_ACTIONS = new Set([
  'left_isolated_locked_off',
  'made_safe_pending_removal_by_others',
  'disconnected_at_db_only_far_end_open',
])

/**
 * The template's three `computed` fields carry plain-English formulas, which
 * the shared engine deliberately passes through verbatim (`computeDerivedField`
 * only evaluates the structured `formula_kind` shape). Showing an electrician
 * the raw formula string is noise, so these three are evaluated explicitly.
 * Anything else renders as "—" rather than guessing.
 */
function derivedValue(fieldId: string, allResponses: FormResponse[]): string {
  if (fieldId === 'circuits_left_temporary' || fieldId === 'circuits_left_temporary_count') {
    const count = allResponses.filter((r) => {
      const parsed = parseRepeatingGroupKey(r.field_id)
      return (
        parsed?.group === 'circuits' &&
        parsed.sub === 'action_taken' &&
        typeof r.value_text === 'string' &&
        TEMPORARY_CIRCUIT_ACTIONS.has(r.value_text)
      )
    }).length
    return String(count)
  }

  if (fieldId === 'all_readings_dead') {
    const readings = allResponses.filter(
      (r) =>
        r.section_id === 'proving_dead' &&
        r.field_id.startsWith('reading_') &&
        typeof r.value_number === 'number',
    )
    if (readings.length === 0) return '—'
    return readings.every((r) => (r.value_number as number) <= 0) ? 'Yes — all dead' : 'No'
  }

  return '—'
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FormFieldRenderer(props: FormRendererProps) {
  const { field, locked, lockNote, sectionId } = props
  const disabled = props.readOnly || !!locked

  const saveKey = `${sectionId}:${field.field_id}`
  const saving = props.savingKeys?.has(saveKey) ?? false
  const saved = props.savedKeys?.has(saveKey) ?? false

  const body = renderBody({ ...props, readOnly: disabled })

  return (
    <div
      id={`field-${props.sectionId}-${cssId(field.field_id)}`}
      style={{
        opacity: locked ? 0.45 : 1,
        // The lock is a real gate, not a hint: no pointer, no keyboard.
        pointerEvents: locked ? 'none' : undefined,
        transition: 'opacity 0.15s',
      }}
      aria-disabled={locked || undefined}
    >
      {body}
      {locked && lockNote && (
        <p style={{ fontSize: 11, color: 'var(--c-amber)', margin: '4px 0 0' }}>{lockNote}</p>
      )}
      {(saving || saved) && (
        <span style={{ fontSize: 10, color: 'var(--c-text-dim)' }}>
          {saving ? 'Saving…' : 'Saved'}
        </span>
      )}
    </div>
  )
}

/** DOM ids must survive the `group[0].sub` synthetic form. */
function cssId(fieldId: string): string {
  return fieldId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function renderBody(p: FormRendererProps) {
  const { field } = p
  switch (field.type) {
    case 'header':
      return <HeaderBlock field={field} />
    case 'pass_fail':
      return <PassFail {...p} />
    case 'text':
    case 'textarea':
      return <Textish {...p} />
    case 'number':
      return <NumberField {...p} />
    case 'date':
      return <DateField {...p} />
    case 'dropdown':
      return <DropdownField {...p} />
    case 'multi_select':
      return <MultiSelectField {...p} />
    case 'photo':
      return <PhotoField {...p} />
    case 'signature':
      return <SignatureField {...p} />
    case 'file':
      return <FileField {...p} />
    case 'computed':
      return <ComputedField {...p} />
    case 'repeating_group':
      return <RepeatingGroup {...p} />
    default:
      return null
  }
}

// ─── Shared label ────────────────────────────────────────────────────────────

function FieldLabel({ field }: { field: Field }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
        {field.label}
        {field.required && <span style={{ color: 'var(--c-red)', marginLeft: 4 }}>*</span>}
        {field.unit && (
          <span style={{ color: 'var(--c-text-dim)', fontWeight: 400 }}> ({field.unit})</span>
        )}
      </label>
      {field.sans_ref && (
        <span
          style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--c-text-dim)', whiteSpace: 'nowrap' }}
        >
          {field.sans_ref}
        </span>
      )}
    </div>
  )
}

function Help({ field }: { field: Field }) {
  if (!field.help_text) return null
  return (
    <p className="form-hint" style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>
      {field.help_text}
    </p>
  )
}

const stackStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }

const controlStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '10px 10px',
  borderRadius: 6,
  border: '1px solid var(--c-border)',
  background: 'var(--c-input-bg)',
  color: 'var(--c-text)',
  fontSize: 15,
}

// ─── Field types ─────────────────────────────────────────────────────────────

function HeaderBlock({ field }: { field: Field }) {
  return (
    <div
      style={{
        borderLeft: '3px solid var(--c-amber-mid)',
        background: 'var(--c-surface)',
        borderRadius: 4,
        padding: '10px 12px',
      }}
    >
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--c-text-mid)' }}>
        {field.label}
      </p>
      {field.help_text && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--c-text-dim)' }}>
          {field.help_text}
        </p>
      )}
    </div>
  )
}

function PassFail({ field, response, readOnly, onChange }: FormRendererProps) {
  const v = response?.value_bool
  const isNa = response?.pass_state === 'na'
  const choice = (
    active: boolean,
    accent: string,
    dim: string,
    text: string,
    onClick: () => void,
  ) => (
    <button
      type="button"
      disabled={readOnly}
      onClick={onClick}
      style={{
        flex: 1,
        minHeight: 48,
        padding: '10px 12px',
        borderRadius: 6,
        border: `1px solid ${active ? accent : 'var(--c-border)'}`,
        background: active ? dim : 'var(--c-panel)',
        color: active ? accent : 'var(--c-text-mid)',
        fontWeight: active ? 600 : 400,
        fontSize: 14,
        cursor: readOnly ? 'not-allowed' : 'pointer',
        opacity: readOnly ? 0.6 : 1,
      }}
    >
      {text}
    </button>
  )

  return (
    <div style={stackStyle}>
      <FieldLabel field={field} />
      <Help field={field} />
      <div style={{ display: 'flex', gap: 8 }}>
        {choice(v === true, 'var(--c-green)', 'var(--c-green-dim)', '✓ Pass', () =>
          onChange({ value_bool: true, pass_state: 'pass', fail_reason: null }),
        )}
        {choice(v === false, 'var(--c-red)', 'var(--c-red-dim)', '✗ Fail', () =>
          onChange({ value_bool: false, pass_state: 'fail' }),
        )}
        {choice(isNa, 'var(--c-text-mid)', 'var(--c-elevated)', 'N/A', () =>
          onChange({ value_bool: null, pass_state: 'na', fail_reason: null }),
        )}
      </div>
      {v === false && (
        <input
          type="text"
          disabled={readOnly}
          placeholder="Reason for fail (required)"
          value={response?.fail_reason ?? ''}
          onChange={(e) =>
            onChange({ value_bool: false, pass_state: 'fail', fail_reason: e.target.value })
          }
          style={controlStyle}
        />
      )}
    </div>
  )
}

function Textish({ field, response, readOnly, onChange }: FormRendererProps) {
  const common = {
    disabled: readOnly,
    value: response?.value_text ?? '',
    onChange: (e: { target: { value: string } }) =>
      onChange({ value_text: e.target.value === '' ? null : e.target.value }),
    style: controlStyle,
  }
  return (
    <div style={stackStyle}>
      <FieldLabel field={field} />
      <Help field={field} />
      {field.type === 'textarea' ? (
        <textarea rows={3} {...common} style={{ ...controlStyle, minHeight: 88, resize: 'vertical' }} />
      ) : (
        <input type="text" {...common} />
      )}
    </div>
  )
}

/**
 * Numbers keep a local draft so a half-typed value ("1,", "-", "0.") is not
 * destroyed by re-deriving the input from the committed number.
 */
function NumberField({ field, response, readOnly, onChange }: FormRendererProps) {
  const committed = response?.value_number ?? null
  const [draft, setDraft] = useState(committed === null ? '' : String(committed))
  const lastCommitted = useRef<number | null>(committed)

  useEffect(() => {
    if (committed !== lastCommitted.current) {
      lastCommitted.current = committed
      setDraft(committed === null ? '' : String(committed))
    }
  }, [committed])

  return (
    <div style={stackStyle}>
      <FieldLabel field={field} />
      <Help field={field} />
      <input
        type="text"
        inputMode="decimal"
        disabled={readOnly}
        value={draft}
        placeholder={field.unit ?? ''}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          if (raw.trim() === '') {
            lastCommitted.current = null
            onChange({ value_number: null })
            return
          }
          // The comma decimal separator is standard in SA electrical practice.
          const n = Number(raw.trim().replace(',', '.'))
          if (Number.isFinite(n)) {
            lastCommitted.current = n
            onChange({ value_number: n })
          }
        }}
        style={controlStyle}
      />
      {field.pass_when && (
        <span style={{ fontSize: 10, color: 'var(--c-text-dim)' }}>
          Acceptance: {field.pass_when} {field.unit ?? ''}
        </span>
      )}
    </div>
  )
}

function DateField({ field, response, readOnly, onChange }: FormRendererProps) {
  return (
    <div style={stackStyle}>
      <FieldLabel field={field} />
      <Help field={field} />
      <input
        type="date"
        disabled={readOnly}
        value={response?.value_text ?? ''}
        onChange={(e) => onChange({ value_text: e.target.value === '' ? null : e.target.value })}
        style={controlStyle}
      />
    </div>
  )
}

function DropdownField({ field, response, readOnly, onChange }: FormRendererProps) {
  return (
    <div style={stackStyle}>
      <FieldLabel field={field} />
      <Help field={field} />
      <select
        disabled={readOnly}
        value={response?.value_text ?? ''}
        onChange={(e) => onChange({ value_text: e.target.value === '' ? null : e.target.value })}
        style={controlStyle}
      >
        <option value="">Select…</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {optionLabel(field.field_id.split('.').pop() ?? field.field_id, o)}
          </option>
        ))}
      </select>
    </div>
  )
}

function MultiSelectField({ field, response, readOnly, onChange }: FormRendererProps) {
  const selected = response?.value_array ?? []
  const toggle = (token: string) => {
    const next = selected.includes(token)
      ? selected.filter((t) => t !== token)
      : [...selected, token]
    onChange({ value_array: next.length > 0 ? next : null })
  }
  return (
    <div style={stackStyle}>
      <FieldLabel field={field} />
      <Help field={field} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(field.options ?? []).map((o) => {
          const on = selected.includes(o)
          return (
            <button
              key={o}
              type="button"
              disabled={readOnly}
              onClick={() => toggle(o)}
              style={{
                minHeight: 44,
                padding: '8px 12px',
                borderRadius: 6,
                border: `1px solid ${on ? 'var(--c-amber-mid)' : 'var(--c-border)'}`,
                background: on ? 'var(--c-amber-dim)' : 'var(--c-panel)',
                color: on ? 'var(--c-amber)' : 'var(--c-text-mid)',
                fontSize: 13,
                fontWeight: on ? 600 : 400,
                cursor: readOnly ? 'not-allowed' : 'pointer',
              }}
            >
              {on ? '✓ ' : ''}
              {optionLabel(field.field_id, o)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PhotoField(p: FormRendererProps) {
  const { field, sectionId, photos } = p
  const mine = photos.filter((x) => x.section_id === sectionId && x.field_id === field.field_id)
  return (
    <div style={stackStyle}>
      <FieldLabel field={field} />
      <Help field={field} />
      <FormPhotoStrip
        projectId={p.projectId}
        formId={p.formId}
        sectionId={sectionId}
        fieldId={field.field_id}
        photos={mine}
        readOnly={p.readOnly}
        currentUserId={p.currentUserId}
        onAdded={p.onPhotoAdded}
        onRemoved={p.onPhotoRemoved}
      />
    </div>
  )
}

function SignatureField(p: FormRendererProps) {
  const { field, signatures, allResponses } = p
  const block = blockForSignatureField(field.field_id)

  if (block) {
    const existing = signatures.find((s) => s.block_id === block)
    // Pre-select the category already captured in §3 for the same person.
    const suggested =
      block === 'registered_person'
        ? (allResponses.find(
            (r) => r.section_id === 'personnel' && r.field_id === 'registered_person_category',
          )?.value_text ?? null)
        : block === 'electrician'
          ? (allResponses.find(
              (r) => r.section_id === 'personnel' && r.field_id === 'electrician_category',
            )?.value_text ?? null)
          : null

    return (
      <SignaturePad
        projectId={p.projectId}
        formId={p.formId}
        blockId={block}
        label={field.label}
        helpText={field.help_text}
        required={field.required}
        readOnly={p.readOnly}
        currentUserId={p.currentUserId}
        suggestedCategory={suggested}
        existing={existing}
        onSaved={p.onSignatureSaved}
      />
    )
  }

  // Not one of the four storage blocks — report the block it relies on rather
  // than opening a second pad that would silently overwrite it.
  const alias = aliasBlockForSignatureField(field.field_id)
  const signed = alias ? signatures.find((s) => s.block_id === alias) : undefined
  return (
    <div style={stackStyle}>
      <FieldLabel field={field} />
      <Help field={field} />
      <div
        style={{
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          padding: 10,
          background: 'var(--c-surface)',
          fontSize: 12,
          color: signed ? 'var(--c-green)' : 'var(--c-text-mid)',
        }}
      >
        {alias ? (
          signed ? (
            <>
              Signed by <strong>{signed.signatory_name}</strong>
              {signed.signed_at ? ` on ${new Date(signed.signed_at).toLocaleString()}` : ''} in the{' '}
              {SIGNATURE_BLOCK_LABELS[alias].toLowerCase()} block of §13 Declarations.
            </>
          ) : (
            <>
              Captured by the {SIGNATURE_BLOCK_LABELS[alias].toLowerCase()} signature in §13
              Declarations, which is not signed yet. One signature is held per block, so it is
              recorded once and referenced here.
            </>
          )
        ) : (
          'No signature block is bound to this field.'
        )}
      </div>
    </div>
  )
}

function FileField({ field }: FormRendererProps) {
  // There is no document bucket for site forms — 00179 ships an image-only
  // photo bucket and a PNG-only signature bucket. Rather than pretend, this
  // states where the attachment belongs today.
  return (
    <div style={stackStyle}>
      <FieldLabel field={field} />
      <Help field={field} />
      <div
        style={{
          border: '1px dashed var(--c-border)',
          borderRadius: 6,
          padding: 10,
          fontSize: 11,
          color: 'var(--c-text-dim)',
        }}
      >
        Document attachments are not yet supported on site forms. Upload the document to the
        project&rsquo;s Documents tab and record its reference in the field above it.
      </div>
    </div>
  )
}

function ComputedField({ field, allResponses }: FormRendererProps) {
  return (
    <div style={stackStyle}>
      <FieldLabel field={field} />
      <Help field={field} />
      <div
        style={{
          padding: '10px 12px',
          borderRadius: 6,
          border: '1px solid var(--c-border)',
          background: 'var(--c-surface)',
          fontFamily: 'var(--font-mono)',
          fontSize: 15,
          color: 'var(--c-text)',
        }}
      >
        {derivedValue(field.field_id, allResponses)}
      </div>
    </div>
  )
}

// ─── Repeating group ─────────────────────────────────────────────────────────

function RepeatingGroup(p: FormRendererProps) {
  const { field, sectionId, allResponses, readOnly, formId } = p
  const subFields = field.fields ?? []

  const sectionResponses = allResponses.filter((r) => r.section_id === sectionId)
  const derived = listRepeatingGroupEntryIndices(field.field_id, sectionResponses)

  // Entries added but not yet answered have no responses, so they exist only
  // in local state until the first sub-field is filled in.
  const [added, setAdded] = useState<number[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set(derived))
  const [removing, setRemoving] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const entries = [...new Set([...derived, ...added])].sort((a, b) => a - b)
  const atMax = field.max_count != null && entries.length >= field.max_count

  // Highest index ever handed out by this component. Without it, two taps on
  // "+ Add entry" inside one render both compute the same index off the stale
  // `entries` array and the second entry is silently swallowed by the Set.
  const highestIssued = useRef(-1)

  const addEntry = () => {
    const base = Math.max(highestIssued.current, entries.length === 0 ? -1 : Math.max(...entries))
    const next = base + 1
    highestIssued.current = next
    setAdded((prev) => [...prev, next])
    setExpanded((prev) => new Set(prev).add(next))
  }

  const removeEntry = async (index: number) => {
    setRemoving(index)
    setError(null)
    const syntheticIds = subFields.map((s) => buildRepeatingGroupKey(field.field_id, index, s.field_id))
    try {
      const supabase = createClient()
      const db = supabase as unknown as EntryDbClient

      // Photo rows first, so their storage paths are known before the rows go.
      const { data: photoRows } = await db
        .schema('field')
        .from('form_photos')
        .select('id, storage_path')
        .eq('form_id', formId)
        .in('field_id', syntheticIds)
      const doomedPhotos = photoRows ?? []

      const { error: respErr } = await db
        .schema('field')
        .from('form_responses')
        .delete()
        .eq('form_id', formId)
        .eq('section_id', sectionId)
        .in('field_id', syntheticIds)
      if (respErr) throw new Error(respErr.message)

      if (doomedPhotos.length > 0) {
        const { error: photoErr } = await db
          .schema('field')
          .from('form_photos')
          .delete()
          .eq('form_id', formId)
          .in('field_id', syntheticIds)
        if (photoErr) throw new Error(photoErr.message)
        await supabase.storage
          .from(SITE_FORM_PHOTO_BUCKET)
          .remove(doomedPhotos.map((x) => x.storage_path).filter(Boolean))
          .catch(() => undefined)
      }

      setAdded((prev) => prev.filter((i) => i !== index))
      setExpanded((prev) => {
        const n = new Set(prev)
        n.delete(index)
        return n
      })
      p.onEntryRemoved(
        syntheticIds,
        doomedPhotos.map((x) => x.id),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FieldLabel field={field} />
      <Help field={field} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map((index) => (
          <EntryBlock
            key={index}
            index={index}
            parent={p}
            subFields={subFields}
            expanded={expanded.has(index)}
            removing={removing === index}
            onToggle={() =>
              setExpanded((prev) => {
                const n = new Set(prev)
                if (n.has(index)) n.delete(index)
                else n.add(index)
                return n
              })
            }
            onRemove={() => void removeEntry(index)}
          />
        ))}
        {entries.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0, fontStyle: 'italic' }}>
            No entries yet.
          </p>
        )}
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={addEntry}
          disabled={atMax}
          style={{
            alignSelf: 'flex-start',
            minHeight: 44,
            padding: '10px 14px',
            borderRadius: 6,
            border: '1px dashed var(--c-border-mid)',
            background: 'transparent',
            color: 'var(--c-text-mid)',
            fontSize: 13,
            cursor: atMax ? 'not-allowed' : 'pointer',
          }}
        >
          + Add entry
        </button>
      )}

      {field.min_count != null && entries.length < field.min_count && (
        <p style={{ fontSize: 11, color: 'var(--c-amber)', margin: 0 }}>
          At least {field.min_count} {field.min_count === 1 ? 'entry is' : 'entries are'} expected.
        </p>
      )}
      {atMax && (
        <p style={{ fontSize: 11, color: 'var(--c-amber)', margin: 0 }}>
          Maximum {field.max_count} entries reached.
        </p>
      )}
      {error && (
        <p className="form-error" style={{ fontSize: 11, color: 'var(--c-red)', margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  )
}

function EntryBlock({
  index,
  parent,
  subFields,
  expanded,
  removing,
  onToggle,
  onRemove,
}: {
  index: number
  parent: FormRendererProps
  subFields: Field[]
  expanded: boolean
  removing: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  // Two-step inline confirm, as everywhere else on this screen.
  const [armed, setArmed] = useState(false)
  const groupField = parent.field
  const label = entryLabel(groupField, index, subFields, parent)

  return (
    <div style={{ border: '1px solid var(--c-border)', borderRadius: 6, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          background: 'var(--c-elevated)',
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          style={{
            flex: 1,
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            color: 'var(--c-text)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            padding: 0,
            minHeight: 24,
          }}
        >
          <span style={{ color: 'var(--c-text-dim)', marginRight: 6 }}>{expanded ? '▾' : '▸'}</span>
          {label}
        </button>
        {!parent.readOnly && (
          <button
            type="button"
            disabled={removing}
            onClick={() => {
              if (armed) {
                setArmed(false)
                onRemove()
              } else {
                setArmed(true)
                setTimeout(() => setArmed(false), 3000)
              }
            }}
            title={armed ? 'Tap again to confirm' : 'Remove entry'}
            style={{
              background: 'transparent',
              border: `1px solid ${armed ? 'var(--c-red)' : 'transparent'}`,
              borderRadius: 6,
              color: 'var(--c-red)',
              cursor: 'pointer',
              fontSize: armed ? 11 : 16,
              lineHeight: 1,
              padding: armed ? '6px 8px' : '4px 8px',
              minHeight: 32,
              whiteSpace: 'nowrap',
            }}
          >
            {removing ? '…' : armed ? 'Tap to remove' : '×'}
          </button>
        )}
      </div>

      {expanded && (
        <div
          style={{
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            background: 'var(--c-panel)',
          }}
        >
          {subFields.map((sub) => {
            const syntheticId = buildRepeatingGroupKey(groupField.field_id, index, sub.field_id)
            // The sub-field is rendered through a proxy carrying the synthetic
            // id, so photos and responses scope to this entry automatically.
            const proxy: Field = { ...sub, field_id: syntheticId }
            if (!isFieldVisible(proxy, parent.allResponses)) return null
            return (
              <FormFieldRenderer
                key={syntheticId}
                {...parent}
                field={proxy}
                response={parent.allResponses.find(
                  (r) => r.section_id === parent.sectionId && r.field_id === syntheticId,
                )}
                locked={false}
                lockNote={null}
                onChange={(patch) => parent.onUpsert(syntheticId, patch)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Expand `{{index}}` and `{{<sub_field_id>}}` in an entry's header label. */
function entryLabel(
  groupField: Field,
  index: number,
  subFields: Field[],
  parent: FormRendererProps,
): string {
  const template = groupField.item_label_template
  if (!template) return `Entry ${index + 1}`
  const expanded = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    if (key === 'index') return String(index + 1)
    const sub = subFields.find((s) => s.field_id === key)
    if (!sub) return '—'
    const syntheticId = buildRepeatingGroupKey(groupField.field_id, index, sub.field_id)
    const r = parent.allResponses.find(
      (x) => x.section_id === parent.sectionId && x.field_id === syntheticId,
    )
    if (!r) return '—'
    if (r.value_text) {
      const pretty = sub.options ? optionLabel(sub.field_id, r.value_text) : r.value_text
      return pretty.length > 34 ? `${pretty.slice(0, 31)}…` : pretty
    }
    if (r.value_number != null) return String(r.value_number)
    if (r.value_bool != null) return r.value_bool ? '✓' : '✗'
    return '—'
  })
  // A label of nothing but placeholders and dashes helps no one.
  return /[A-Za-z0-9]/.test(expanded.replace(/—/g, '')) ? expanded : `Entry ${index + 1}`
}
