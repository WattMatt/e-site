'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  buildGateInput,
  evaluateSubmitGates,
  isFieldVisible,
  listRepeatingGroupEntryIndices,
  SITE_FORM_SIGNATURE_FIELD_BLOCKS,
  type Field,
  type GateIssue,
  type GateResponseRow,
  type Response as FormResponse,
  type Section,
  type SubSection,
  type Template,
} from '@esite/shared'
import { submitSiteFormAction, upsertFormResponseAction } from '@/actions/site-forms.actions'
import FormFieldRenderer from './FormFieldRenderer'
import type { FormPhotoRow } from './FormPhotoStrip'
import type { FormSignatureRow } from './SignaturePad'

/**
 * Capture screen for one site form.
 *
 * Everything here is written for a tablet held at a distribution board: large
 * targets, one column, sections collapsed until needed, and no interaction
 * that depends on hover or a keyboard.
 */

/** The safe-isolation section is answerable in order only. */
const SEQUENCED_SECTION_ID = 'safe_isolation'

const SEQUENCE_NOTE =
  'This checklist is answerable in order only. Each step unlocks the next. A safe-isolation ' +
  'record that can be back-filled after the fact proves nothing in an incident enquiry — the ' +
  'sequence is the evidence, not the ticks.'

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge badge-muted',
  submitted: 'badge badge-blue',
  distributed: 'badge badge-green',
  void: 'badge badge-red',
}

const STATUS_NOTE: Record<string, string> = {
  submitted:
    'This form has been submitted. Responses are frozen; correcting it means voiding it and issuing a new record.',
  distributed:
    'This form has been distributed to the project team. Responses are frozen; correcting it means voiding it and issuing a new record.',
  void: 'This form has been voided. It stays on record for audit but is no longer a live document.',
}

export interface CaptureFormProps {
  projectId: string
  projectName: string
  formId: string
  formNo: string | null
  boardLabel: string
  status: string
  voidReason: string | null
  template: Template
  templateName: string
  templateVersion: string
  initialResponses: FormResponse[]
  initialPhotos: FormPhotoRow[]
  initialSignatures: FormSignatureRow[]
  currentUserId: string | null
  createdByName: string | null
  submittedByName: string | null
  submittedAt: string | null
  /** Whether the caller may edit — role gate AND draft status, resolved server-side. */
  canEdit: boolean
  /** Computed on the server so the gate messages do not differ between renders. */
  todayISO: string
}

interface SectionStat {
  answered: number
  total: number
  missingRequired: number
}

export default function CaptureForm(props: CaptureFormProps) {
  const {
    projectId,
    formId,
    template,
    canEdit,
    todayISO,
    status,
  } = props

  const router = useRouter()

  const [responses, setResponses] = useState<FormResponse[]>(props.initialResponses)
  const [photos, setPhotos] = useState<FormPhotoRow[]>(props.initialPhotos)
  const [signatures, setSignatures] = useState<FormSignatureRow[]>(props.initialSignatures)

  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set())
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set())
  const [saveError, setSaveError] = useState<string | null>(null)

  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(template.sections[0] ? [template.sections[0].section_id] : []),
  )
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [serverIssues, setServerIssues] = useState<GateIssue[] | null>(null)

  // Mirror of `responses` that is correct synchronously, so two fields edited
  // inside the same tick both merge onto the latest array rather than racing.
  const responsesRef = useRef<FormResponse[]>(props.initialResponses)
  // One debounce timer per `${sectionId}:${fieldId}` — a field never waits on
  // another field's in-flight save.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // The payload each pending timer will send, so a flush can send it early.
  const pending = useRef<Map<string, FormResponse>>(new Map())

  // ── Autosave ───────────────────────────────────────────────────────────────

  const flushKey = useCallback(
    async (key: string) => {
      const payload = pending.current.get(key)
      if (!payload) return
      pending.current.delete(key)
      const timer = timers.current.get(key)
      if (timer) {
        clearTimeout(timer)
        timers.current.delete(key)
      }

      setSavingKeys((prev) => new Set(prev).add(key))
      try {
        const result = await upsertFormResponseAction({
          formId,
          projectId,
          sectionId: payload.section_id,
          fieldId: payload.field_id,
          valueBool: payload.value_bool ?? null,
          valueNumber: payload.value_number ?? null,
          valueText: payload.value_text ?? null,
          valueArray: payload.value_array ?? null,
          passState: payload.pass_state ?? null,
          failReason: payload.fail_reason ?? null,
        })
        if ('error' in result && result.error) {
          setSaveError(result.error)
          return
        }
        setSaveError(null)
        setSavedKeys((prev) => new Set(prev).add(key))
        setTimeout(() => {
          setSavedKeys((prev) => {
            const n = new Set(prev)
            n.delete(key)
            return n
          })
        }, 1500)
      } catch (e) {
        setSaveError((e as Error).message)
      } finally {
        setSavingKeys((prev) => {
          const n = new Set(prev)
          n.delete(key)
          return n
        })
      }
    },
    [formId, projectId],
  )

  const updateResponse = useCallback(
    (sectionId: string, fieldId: string, patch: Partial<FormResponse>) => {
      const prev = responsesRef.current
      const idx = prev.findIndex((r) => r.section_id === sectionId && r.field_id === fieldId)
      // The upsert writes the whole row, so the merged response is sent — a
      // patch alone would null out every column it does not mention.
      const merged: FormResponse =
        idx >= 0
          ? { ...prev[idx], ...patch }
          : { section_id: sectionId, field_id: fieldId, ...patch }
      const next = idx >= 0 ? prev.map((r, i) => (i === idx ? merged : r)) : [...prev, merged]

      responsesRef.current = next
      setResponses(next)
      // A server rejection describes the form as it was; once it changes, the
      // live client evaluation is the honest thing to show.
      setServerIssues(null)

      if (!canEdit) return

      const key = `${sectionId}:${fieldId}`
      pending.current.set(key, merged)
      const existing = timers.current.get(key)
      if (existing) clearTimeout(existing)
      timers.current.set(
        key,
        setTimeout(() => {
          void flushKey(key)
        }, 800),
      )
    },
    [canEdit, flushKey],
  )

  const flushAll = useCallback(async () => {
    await Promise.all([...pending.current.keys()].map((k) => flushKey(k)))
  }, [flushKey])

  const purgeResponses = useCallback((fieldIds: string[], photoIds: string[]) => {
    const doomed = new Set(fieldIds)
    responsesRef.current = responsesRef.current.filter((r) => !doomed.has(r.field_id))
    setResponses(responsesRef.current)
    // Cancel any debounce still queued for a field that no longer exists, so a
    // timer cannot resurrect a deleted entry 800 ms after it was removed. Keys
    // are `${sectionId}:${fieldId}` and field ids contain no colon.
    for (const key of [...pending.current.keys()]) {
      if (!doomed.has(key.slice(key.indexOf(':') + 1))) continue
      pending.current.delete(key)
      const t = timers.current.get(key)
      if (t) clearTimeout(t)
      timers.current.delete(key)
    }
    if (photoIds.length > 0) {
      const doomedPhotos = new Set(photoIds)
      setPhotos((prev) => prev.filter((x) => !doomedPhotos.has(x.id)))
    }
  }, [])

  // ── Answeredness, stats and the section-6 lock ─────────────────────────────

  const isAnswered = useCallback(
    (sectionId: string, field: Field): boolean => {
      if (field.type === 'header' || field.type === 'computed') return false

      if (field.type === 'photo') {
        return photos.some((p) => p.section_id === sectionId && p.field_id === field.field_id)
      }
      if (field.type === 'signature') {
        // Every signature field owns its own block, so a step is satisfied only
        // by its OWN signature — no field can be ticked off by another's.
        const block = SITE_FORM_SIGNATURE_FIELD_BLOCKS[field.field_id]
        return !!block && signatures.some((s) => s.block_id === block)
      }
      if (field.type === 'repeating_group') {
        return (
          listRepeatingGroupEntryIndices(
            field.field_id,
            responses.filter((r) => r.section_id === sectionId),
          ).length > 0
        )
      }
      if (field.type === 'file') {
        // No document bucket exists for site forms yet, so a file field can
        // never be answered. Counting it would make every section unfinishable.
        return true
      }

      const r = responses.find((x) => x.section_id === sectionId && x.field_id === field.field_id)
      if (!r) return false
      return (
        r.value_bool != null ||
        r.value_number != null ||
        (r.value_text != null && r.value_text.trim() !== '') ||
        (r.value_array != null && r.value_array.length > 0) ||
        r.pass_state === 'na'
      )
    },
    [photos, signatures, responses],
  )

  const sectionStats = useMemo(() => {
    const stats = new Map<string, SectionStat>()
    for (const section of template.sections) {
      const acc: SectionStat = { answered: 0, total: 0, missingRequired: 0 }
      const tally = (f: Field, subsection?: SubSection) => {
        if (f.type === 'header' || f.type === 'computed') return
        if (!isFieldVisible(f, responses, { section, subsection })) return
        acc.total++
        if (isAnswered(section.section_id, f)) acc.answered++
        else if (f.required) acc.missingRequired++
      }
      for (const f of section.fields ?? []) tally(f)
      for (const ss of section.subsections ?? []) for (const f of ss.fields) tally(f, ss)
      stats.set(section.section_id, acc)
    }
    return stats
  }, [template, responses, isAnswered])

  /**
   * Section 6 sequencing.
   *
   * The visible, answerable steps of the safe-isolation section are walked in
   * template order. Everything after the FIRST unanswered step is locked, so a
   * step can be corrected once answered but none can be skipped ahead to.
   */
  const lockedFieldIds = useMemo(() => {
    const section = template.sections.find((s) => s.section_id === SEQUENCED_SECTION_ID)
    if (!section) return new Set<string>()

    const steps: Field[] = []
    for (const f of section.fields ?? []) {
      if (f.type === 'header' || f.type === 'computed') continue
      if (!isFieldVisible(f, responses, { section })) continue
      steps.push(f)
    }
    for (const ss of section.subsections ?? []) {
      for (const f of ss.fields) {
        if (f.type === 'header' || f.type === 'computed') continue
        if (!isFieldVisible(f, responses, { section, subsection: ss })) continue
        steps.push(f)
      }
    }

    const firstUnanswered = steps.findIndex((f) => !isAnswered(SEQUENCED_SECTION_ID, f))
    if (firstUnanswered === -1) return new Set<string>()
    return new Set(steps.slice(firstUnanswered + 1).map((f) => f.field_id))
  }, [template, responses, isAnswered])

  // ── Live gates ─────────────────────────────────────────────────────────────

  const clientIssues = useMemo(() => {
    const rows: GateResponseRow[] = responses.map((r) => ({
      section_id: r.section_id,
      field_id: r.field_id,
      value_bool: r.value_bool ?? null,
      value_number: r.value_number ?? null,
      value_text: r.value_text ?? null,
      value_array: r.value_array ?? null,
    }))
    return evaluateSubmitGates(buildGateInput(rows, todayISO))
  }, [responses, todayISO])

  const totals = useMemo(() => {
    let answered = 0
    let total = 0
    let missingRequired = 0
    for (const s of sectionStats.values()) {
      answered += s.answered
      total += s.total
      missingRequired += s.missingRequired
    }
    return { answered, total, missingRequired }
  }, [sectionStats])

  const jumpToSection = (sectionId: string) => {
    setOpenSections((prev) => new Set(prev).add(sectionId))
    // Let the section paint before scrolling to it.
    setTimeout(() => {
      document
        .getElementById(`section-${sectionId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  const onSubmit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    setServerIssues(null)
    try {
      // Anything still sitting on a debounce must reach the database first —
      // the server re-reads the stored responses to evaluate the gates.
      await flushAll()
      const result = await submitSiteFormAction(formId, projectId)
      if ('error' in result && result.error) {
        setSubmitError(result.error)
        return
      }
      if ('issues' in result && result.issues) {
        setServerIssues(result.issues)
        return
      }
      router.refresh()
    } catch (e) {
      setSubmitError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const issuesToShow = serverIssues ?? clientIssues
  const readOnly = !canEdit

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{props.formNo ?? 'Unnumbered form'}</h1>
          <p className="page-subtitle">
            {props.templateName} v{props.templateVersion} · {props.boardLabel} · {props.projectName}
          </p>
        </div>
        <Link href={`/projects/${projectId}/forms`} className="btn">
          Back to forms
        </Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className={STATUS_BADGE[status] ?? 'badge badge-muted'}>{status}</span>
        {props.createdByName && (
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            Captured by {props.createdByName}
          </span>
        )}
        {props.submittedByName && props.submittedAt && (
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            Submitted by {props.submittedByName} on {new Date(props.submittedAt).toLocaleString()}
          </span>
        )}
      </div>

      {readOnly && (
        <div
          className="card"
          style={{
            border: '1px solid var(--c-border-mid)',
            borderLeft: '3px solid var(--c-amber)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 12,
            background: 'var(--c-surface)',
          }}
        >
          <strong style={{ fontSize: 13, color: 'var(--c-text)' }}>
            {status === 'draft' ? 'Read only' : `This form is ${status}`}
          </strong>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--c-text-mid)' }}>
            {STATUS_NOTE[status] ??
              'Your role can view this record but not edit it. Nothing you do here will be saved.'}
          </p>
          {status === 'void' && props.voidReason && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--c-red)' }}>
              Reason: {props.voidReason}
            </p>
          )}
        </div>
      )}

      {saveError && (
        <p className="form-error" style={{ fontSize: 12, color: 'var(--c-red)' }}>
          Last change could not be saved: {saveError}
        </p>
      )}

      {/* Live gate panel. Guidance only — submitSiteFormAction re-evaluates the
          same pure function server-side against the stored responses. */}
      <div
        style={{
          position: 'sticky',
          top: 8,
          zIndex: 20,
          marginBottom: 14,
          border: `1px solid ${issuesToShow.length > 0 ? 'var(--c-red)' : 'var(--c-green)'}`,
          borderRadius: 8,
          background: 'var(--c-surface)',
          padding: 12,
          boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
            {issuesToShow.length > 0
              ? `${issuesToShow.length} ${issuesToShow.length === 1 ? 'issue blocks' : 'issues block'} submission`
              : 'No blocking issues'}
            <span style={{ fontWeight: 400, color: 'var(--c-text-dim)', marginLeft: 8, fontSize: 12 }}>
              {totals.answered}/{totals.total} answered
              {totals.missingRequired > 0 ? ` · ${totals.missingRequired} required outstanding` : ''}
            </span>
          </div>
          {!readOnly && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onSubmit()}
              disabled={submitting || clientIssues.length > 0}
              style={{
                minHeight: 44,
                padding: '10px 18px',
                borderRadius: 6,
                border: '1px solid var(--c-amber-mid)',
                background: clientIssues.length > 0 ? 'var(--c-elevated)' : 'var(--c-amber-dim)',
                color: clientIssues.length > 0 ? 'var(--c-text-dim)' : 'var(--c-amber)',
                fontWeight: 600,
                fontSize: 14,
                cursor: submitting || clientIssues.length > 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Submitting…' : 'Submit form'}
            </button>
          )}
        </div>

        {issuesToShow.length > 0 && (
          <ul style={{ margin: '10px 0 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {issuesToShow.map((issue) => (
              <li key={issue.code} style={{ fontSize: 12, color: 'var(--c-text-mid)', lineHeight: 1.45 }}>
                <button
                  type="button"
                  onClick={() => jumpToSection(issue.sectionId)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    marginRight: 6,
                    color: 'var(--c-amber)',
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  {sectionTitle(template, issue.sectionId)} →
                </button>
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        {serverIssues && serverIssues.length > 0 && (
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--c-text-dim)' }}>
            Reported by the server on submit. It re-evaluates the same rules against the stored
            responses, so this list is authoritative.
          </p>
        )}
        {submitError && (
          <p className="form-error" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--c-red)' }}>
            {submitError}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {template.sections.map((section) => {
          const stat = sectionStats.get(section.section_id) ?? {
            answered: 0,
            total: 0,
            missingRequired: 0,
          }
          const isOpen = openSections.has(section.section_id)
          const visible = !section.conditional_on || sectionIsVisible(section, responses)
          if (!visible) return null

          return (
            <section
              key={section.section_id}
              id={`section-${section.section_id}`}
              className="card"
              style={{
                border: '1px solid var(--c-border)',
                borderRadius: 8,
                background: 'var(--c-panel)',
                overflow: 'hidden',
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setOpenSections((prev) => {
                    const n = new Set(prev)
                    if (n.has(section.section_id)) n.delete(section.section_id)
                    else n.add(section.section_id)
                    return n
                  })
                }
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  minHeight: 56,
                  padding: '12px 14px',
                  background: 'var(--c-elevated)',
                  border: 'none',
                  borderBottom: isOpen ? '1px solid var(--c-border)' : 'none',
                  color: 'var(--c-text)',
                  fontSize: 14,
                  fontWeight: 600,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span>
                  <span style={{ color: 'var(--c-text-dim)', marginRight: 8 }}>
                    {isOpen ? '▾' : '▸'}
                  </span>
                  {section.title}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {stat.missingRequired > 0 && (
                    <span className="badge badge-red" style={{ fontSize: 10 }}>
                      {stat.missingRequired} required
                    </span>
                  )}
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color:
                        stat.total > 0 && stat.answered === stat.total
                          ? 'var(--c-green)'
                          : 'var(--c-text-dim)',
                    }}
                  >
                    {stat.answered}/{stat.total}
                  </span>
                </span>
              </button>

              {isOpen && (
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {section.section_id === SEQUENCED_SECTION_ID && (
                    <p
                      style={{
                        margin: 0,
                        borderLeft: '3px solid var(--c-amber)',
                        background: 'var(--c-surface)',
                        borderRadius: 4,
                        padding: '10px 12px',
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: 'var(--c-text-mid)',
                      }}
                    >
                      {SEQUENCE_NOTE}
                    </p>
                  )}

                  {(section.fields ?? []).map((field) =>
                    renderField(field, section, undefined),
                  )}

                  {(section.subsections ?? []).map((ss) => {
                    const anyVisible = ss.fields.some((f) =>
                      isFieldVisible(f, responses, { section, subsection: ss }),
                    )
                    if (!anyVisible) return null
                    return (
                      <div
                        key={ss.subsection_id}
                        style={{
                          borderTop: '1px solid var(--c-border)',
                          paddingTop: 14,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 18,
                        }}
                      >
                        <h3
                          style={{
                            margin: 0,
                            fontSize: 12,
                            fontWeight: 600,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            color: 'var(--c-text-mid)',
                          }}
                        >
                          {ss.title}
                        </h3>
                        {ss.fields.map((field) => renderField(field, section, ss))}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )

  function renderField(field: Field, section: Section, subsection: SubSection | undefined) {
    if (!isFieldVisible(field, responses, { section, subsection })) return null
    const locked =
      section.section_id === SEQUENCED_SECTION_ID && lockedFieldIds.has(field.field_id)

    return (
      <FormFieldRenderer
        key={field.field_id}
        field={field}
        sectionId={section.section_id}
        response={responses.find(
          (r) => r.section_id === section.section_id && r.field_id === field.field_id,
        )}
        allResponses={responses}
        projectId={projectId}
        formId={formId}
        currentUserId={props.currentUserId}
        photos={photos}
        signatures={signatures}
        readOnly={readOnly}
        locked={locked}
        lockNote={locked ? 'Answer the step above before this one.' : null}
        savingKeys={savingKeys}
        savedKeys={savedKeys}
        onChange={(patch) => updateResponse(section.section_id, field.field_id, patch)}
        onUpsert={(fieldId, patch) => updateResponse(section.section_id, fieldId, patch)}
        onPhotoAdded={(row) => setPhotos((prev) => [...prev, row])}
        onPhotoRemoved={(id) => setPhotos((prev) => prev.filter((x) => x.id !== id))}
        onSignatureSaved={(row) =>
          setSignatures((prev) => [...prev.filter((s) => s.block_id !== row.block_id), row])
        }
        onEntryRemoved={purgeResponses}
      />
    )
  }
}

function sectionTitle(template: Template, sectionId: string): string {
  return template.sections.find((s) => s.section_id === sectionId)?.title ?? sectionId
}

/**
 * Section-level `conditional_on` is evaluated through the engine by borrowing
 * the section's condition onto a throwaway field — `isFieldVisible` is the only
 * exported entry point to the condition matcher.
 */
function sectionIsVisible(section: Section, responses: FormResponse[]): boolean {
  if (!section.conditional_on) return true
  const probe: Field = {
    field_id: `__section_probe_${section.section_id}`,
    label: '',
    type: 'text',
    conditional_on: section.conditional_on,
  }
  return isFieldVisible(probe, responses)
}
