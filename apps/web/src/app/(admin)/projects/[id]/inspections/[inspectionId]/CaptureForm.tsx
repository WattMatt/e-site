'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { evaluateInspection, isFieldVisible, describeMissing } from '@esite/shared'
import type { Template, Response as InspectionResponse, Field } from '@esite/shared'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useRouter } from 'next/navigation'
import { useArmedConfirm } from '@/lib/solar/useArmedConfirm'
import { upsertResponseAction, submitInspectionAction } from '@/actions/inspections.actions'
import FieldRenderer from './FieldRenderer'
import CertifyModal from './CertifyModal'
import { PhotoTallyContext, type PhotoTally, type CapturedSignature } from './fields/photo-tally'

type Mode = 'capture' | 'preview'

interface Props {
  inspectionId: string
  projectId?: string
  template: Template
  initialResponses: InspectionResponse[]
  initialPhotos?: { section_id: string; field_id: string }[]
  initialSignatures?: CapturedSignature[]
  status?: string
  verifierId?: string | null
  /** The template needs a verifier who did not fill it in (00248): the verifier gets no flip mode. */
  separateVerifier?: boolean
  currentUserId: string | null
  mode: Mode
  readOnly?: boolean
}

export default function CaptureForm({
  inspectionId,
  projectId,
  template,
  initialResponses,
  initialPhotos,
  initialSignatures,
  status,
  verifierId,
  separateVerifier = false,
  currentUserId,
  mode,
  readOnly: readOnlyProp,
}: Props) {
  const [responses, setResponses] = useState<InspectionResponse[]>(initialResponses)
  // Loaded on the server, then kept current by every photo/file/signature field through
  // PhotoTallyContext, so section progress and the Submit check see an upload without a reload.
  const [photos, setPhotos] = useState<{ section_id: string; field_id: string }[]>(initialPhotos ?? [])
  const [signatures, setSignatures] = useState<CapturedSignature[]>(initialSignatures ?? [])
  const photoTally = useMemo<PhotoTally>(
    () => ({
      signatures,
      // The upload route replaces an earlier signature on the same field, so do the same here.
      signed: (sig) =>
        setSignatures((prev) => [
          ...prev.filter((x) => !(x.section_id === sig.section_id && x.field_id === sig.field_id)),
          sig,
        ]),
      added: (section_id, field_id) => setPhotos((prev) => [...prev, { section_id, field_id }]),
      removed: (section_id, field_id) =>
        setPhotos((prev) => {
          const i = prev.findIndex((p) => p.section_id === section_id && p.field_id === field_id)
          return i < 0 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)]
        }),
    }),
    [signatures],
  )
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<string>(template.sections[0]?.section_id ?? '')
  const [savingFields, setSavingFields] = useState<Set<string>>(new Set())
  const [showCertify, setShowCertify] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Two-step inline confirm, not window.confirm: Safari can suppress native dialogs,
  // which made Submit do nothing (seen on production, 2026-10-06).
  const submitConfirm = useArmedConfirm()
  const router = useRouter()
  const debouncers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const isPreview = mode === 'preview'
  const isCertifiedOrAbandoned = status === 'certified' || status === 'abandoned'
  const isVerifier =
    currentUserId !== null && verifierId === currentUserId && status === 'awaiting_verification'
  // Flipping an answer is an answer: on a separate-verifier template it would be recorded as the
  // verifier's contribution and bar them from certifying (certification_blockers, 00235).
  const canFlip = isVerifier && !separateVerifier
  const readOnly =
    readOnlyProp || isPreview || isCertifiedOrAbandoned || status === 'awaiting_verification'

  const evaluation = useMemo(
    () => evaluateInspection(template, responses, { photos, signatures }),
    [template, responses, photos, signatures],
  )

  // Every gap, named, with what completes it: shown in the summary so "Submit refuses a finished
  // form" can never happen silently.
  const missingItems = useMemo(
    () => describeMissing(template, evaluation.missingRequired, { photos, signatures }),
    [template, evaluation.missingRequired, photos, signatures],
  )
  const jumpTo = useCallback((sectionId: string, fieldId: string) => {
    setActiveSection(sectionId)
    // The section renders on the next paint; look for the entry after it.
    requestAnimationFrame(() => {
      const el = document.getElementById(`field-${sectionId}-${fieldId}`) ?? document.getElementById(`field-${sectionId}-${fieldId.split('[')[0]}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.classList.add('ring-required')
      setTimeout(() => el?.classList.remove('ring-required'), 2500)
    })
  }, [])

  // One count for the rail and the summary: photo, file and signature fields count as answered
  // once uploaded (the rail used to count typed answers only, so photo sections read 0/4).
  const sectionStats = evaluation.sectionStats

  // Saves waiting out their debounce, and saves on the wire. Submit flushes both, so it never
  // races the last answer (the server checks completeness against what is saved).
  const pendingSaves = useRef<Map<string, () => Promise<void>>>(new Map())
  const inflight = useRef<Set<Promise<void>>>(new Set())
  const [saveError, setSaveError] = useState<string | null>(null)
  // Template defaults shown on open but not yet written: writing them makes the viewer a
  // contributor (response_history), which on a separate-verifier template bars them from
  // verifying, so they are written only with the person's first real edit or at Submit.
  const deferredDefaults = useRef<Array<{ sectionId: string; fieldId: string; patch: Partial<InspectionResponse> }>>([])

  const startSave = useCallback((key: string) => {
    const run = pendingSaves.current.get(key)
    if (!run) return
    pendingSaves.current.delete(key)
    const t = debouncers.current.get(key)
    if (t) clearTimeout(t)
    debouncers.current.delete(key)
    const p = run().finally(() => inflight.current.delete(p))
    inflight.current.add(p)
  }, [])

  const scheduleSave = useCallback(
    (sectionId: string, fieldId: string, patch: Partial<InspectionResponse>) => {
      const key = `${sectionId}:${fieldId}`
      pendingSaves.current.set(key, async () => {
        setSavingFields((prev) => new Set(prev).add(key))
        try {
          await upsertResponseAction({
            inspectionId,
            sectionId,
            fieldId,
            value: {
              value_bool: patch.value_bool ?? null,
              value_number: patch.value_number ?? null,
              value_text: patch.value_text ?? null,
              value_array: patch.value_array ?? null,
              value_json: patch.value_json ?? null,
              pass_state: patch.pass_state,
              fail_reason: patch.fail_reason ?? null,
            },
          })
        } catch (err) {
          console.error('Autosave failed', err)
          setSaveError('An answer did not save. Check your connection, then change it again.')
        } finally {
          setSavingFields((prev) => {
            const n = new Set(prev)
            n.delete(key)
            return n
          })
        }
      })
      const existing = debouncers.current.get(key)
      if (existing) clearTimeout(existing)
      debouncers.current.set(key, setTimeout(() => startSave(key), 800))
    },
    [inspectionId, startSave],
  )

  const writeDeferredDefaults = useCallback(() => {
    const due = deferredDefaults.current
    deferredDefaults.current = []
    for (const d of due) scheduleSave(d.sectionId, d.fieldId, d.patch)
  }, [scheduleSave])

  /** Writes everything still pending and waits for it. */
  const flushSaves = useCallback(async () => {
    writeDeferredDefaults()
    for (const key of [...pendingSaves.current.keys()]) startSave(key)
    await Promise.all([...inflight.current])
  }, [startSave, writeDeferredDefaults])

  const updateResponse = useCallback(
    (sectionId: string, fieldId: string, patch: Partial<InspectionResponse>, persist = true) => {
      setResponses((prev) => {
        const idx = prev.findIndex((r) => r.section_id === sectionId && r.field_id === fieldId)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], ...patch }
          return next
        }
        return [...prev, { section_id: sectionId, field_id: fieldId, ...patch } as InspectionResponse]
      })

      if (isPreview) return
      if (!persist) {
        deferredDefaults.current.push({ sectionId, fieldId, patch })
        return
      }
      writeDeferredDefaults()
      scheduleSave(sectionId, fieldId, patch)
    },
    [isPreview, scheduleSave, writeDeferredDefaults],
  )

  // Seed template default_value into responses once on mount, so a field's default is shown and
  // counted, and later persisted to the DB (the fill widgets only show defaults; without this an
  // untouched default never lands in inspections.responses). It is written with the person's first
  // real edit or at Submit, never merely by opening the page (see deferredDefaults).
  // Repeating-group sub-fields are seeded per entry by their own widgets, not here.
  // Runs once; skipped in read-only/preview.
  const seededDefaultsRef = useRef(false)
  useEffect(() => {
    if (seededDefaultsRef.current) return
    seededDefaultsRef.current = true
    if (readOnly) return
    const seedable = new Set(['text', 'textarea', 'number', 'date', 'dropdown'])
    const consider = (sectionId: string, f: Field) => {
      if (!seedable.has(f.type) || f.default_value == null) return
      const exists = responses.some((r) => r.section_id === sectionId && r.field_id === f.field_id)
      if (exists) return
      if (f.type === 'number') {
        if (typeof f.default_value !== 'number') return
        updateResponse(sectionId, f.field_id, { value_number: f.default_value }, false)
      } else {
        updateResponse(sectionId, f.field_id, { value_text: String(f.default_value) }, false)
      }
    }
    for (const s of template.sections) {
      for (const f of s.fields ?? []) consider(s.section_id, f)
      for (const ss of s.subsections ?? []) for (const f of ss.fields) consider(s.section_id, f)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSubmit = async () => {
    if (evaluation.missingRequired.length > 0) {
      const first = evaluation.missingRequired[0]
      const n = evaluation.missingRequired.length
      const where = template.sections.find((x) => x.section_id === first.sectionId)?.title ?? first.sectionId
      setSubmitError(`${n} required ${n === 1 ? 'item is' : 'items are'} still missing (listed under Still required). The first is in "${where}".`)
      jumpTo(first.sectionId, first.fieldId)
      return
    }
    if (!projectId) return
    if (!submitConfirm.armed) {
      submitConfirm.arm()
      return
    }
    submitConfirm.disarm()
    setSubmitting(true)
    setSubmitError(null)
    try {
      await flushSaves()
      const res = await submitInspectionAction(inspectionId, projectId)
      if (!res.ok) {
        setSubmitError(res.error)
        return
      }
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  const section = template.sections.find((s) => s.section_id === activeSection)

  const overallVariant: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'ghost' =
    evaluation.overallResult === 'pass'
      ? 'success'
      : evaluation.overallResult === 'fail'
        ? 'danger'
        : 'warning'

  return (
    <PhotoTallyContext.Provider value={photoTally}>
    <div className="stack-below-lg"
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr 300px',
        gap: 16,
        alignItems: 'start',
      }}
    >
      {/* Left rail — section nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'sticky', top: 16 }}>
        {template.sections.map((s) => {
          const st = sectionStats[s.section_id] ?? { answered: 0, total: 0, missing: 0 }
          const isActive = activeSection === s.section_id
          return (
            <button
              key={s.section_id}
              onClick={() => setActiveSection(s.section_id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--c-border)',
                background: isActive ? 'var(--c-panel-2, var(--c-panel))' : 'transparent',
                fontSize: 12,
                color: 'var(--c-text)',
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{s.title}</span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--c-text-dim)',
                  }}
                >
                  {st.answered}/{st.total}
                </span>
              </div>
              {st.missing > 0 && (
                <div style={{ marginTop: 4 }}>
                  <Badge variant="danger">{st.missing} required</Badge>
                </div>
              )}
            </button>
          )
        })}
      </nav>

      {/* Centre — active section fields */}
      <Card>
        <CardBody>
          {!section && (
            <p style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>No section selected.</p>
          )}
          {section && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--c-text)', margin: 0 }}>
                {section.title}
              </h2>
              {(section.fields ?? []).map((field) => {
                if (!isFieldVisible(field, responses, { section })) return null
                const response = responses.find(
                  (r) => r.section_id === section.section_id && r.field_id === field.field_id,
                )
                const key = `${section.section_id}:${field.field_id}`
                return (
                  <div
                    key={field.field_id}
                    id={`field-${section.section_id}-${field.field_id}`}
                    style={{ transition: 'box-shadow 0.2s' }}
                  >
                    <FieldRenderer
                      field={field}
                      response={response}
                      inspectionId={inspectionId}
                      sectionId={section.section_id}
                      readOnly={readOnly && !canFlip}
                      verifierFlipMode={canFlip}
                      onChange={(patch) => updateResponse(section.section_id, field.field_id, patch)}
                      allResponses={responses}
                      onUpsert={(fid, patch) => updateResponse(section.section_id, fid, patch)}
                    />
                    {savingFields.has(key) && (
                      <span style={{ fontSize: 10, color: 'var(--c-text-dim)' }}>Saving…</span>
                    )}
                  </div>
                )
              })}
              {(section.subsections ?? []).map((ss) => {
                // Subsection-level conditional_on — hide entire subsection if condition fails
                if (ss.conditional_on && !isFieldVisible({ ...ss.fields[0], conditional_on: ss.conditional_on } as Field, responses, { section })) {
                  return null
                }
                return (
                  <div
                    key={ss.subsection_id}
                    style={{
                      marginTop: 8,
                      paddingTop: 12,
                      borderTop: '1px solid var(--c-border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    <h3
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--c-text-mid)',
                        margin: 0,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {ss.title}
                    </h3>
                    {ss.fields.map((field) => {
                      if (!isFieldVisible(field, responses, { section, subsection: ss })) return null
                      const response = responses.find(
                        (r) => r.section_id === section.section_id && r.field_id === field.field_id,
                      )
                      const key = `${section.section_id}:${field.field_id}`
                      return (
                        <div
                          key={field.field_id}
                          id={`field-${section.section_id}-${field.field_id}`}
                          style={{ transition: 'box-shadow 0.2s' }}
                        >
                          <FieldRenderer
                            field={field}
                            response={response}
                            inspectionId={inspectionId}
                            sectionId={section.section_id}
                            readOnly={readOnly && !canFlip}
                            verifierFlipMode={canFlip}
                            onChange={(patch) => updateResponse(section.section_id, field.field_id, patch)}
                          />
                          {savingFields.has(key) && (
                            <span style={{ fontSize: 10, color: 'var(--c-text-dim)' }}>Saving…</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Right rail — summary + actions */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 16 }}>
        <Card>
          <CardBody>
            <h3
              style={{
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.06em',
                color: 'var(--c-text-dim)',
                marginTop: 0,
                marginBottom: 10,
                textTransform: 'uppercase',
              }}
            >
              Summary
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <div>
                Overall: <Badge variant={overallVariant}>{evaluation.overallResult}</Badge>
              </div>
              <div style={{ color: 'var(--c-text-mid)' }}>
                Answered: {evaluation.answeredFieldCount} / {evaluation.visibleFieldCount}
              </div>
              {missingItems.length > 0 && (
                <div>
                  <div style={{ color: 'var(--c-red)', marginBottom: 4 }}>Still required: {missingItems.length}</div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {missingItems.map((m) => (
                      <li key={`${m.sectionId}:${m.fieldId}`}>
                        <button
                          type="button"
                          onClick={() => jumpTo(m.sectionId, m.fieldId)}
                          style={{ all: 'unset', cursor: 'pointer', display: 'block', fontSize: 12, color: 'var(--c-text)' }}
                        >
                          <span style={{ fontWeight: 500 }}>{m.label}</span>
                          <span style={{ color: 'var(--c-red)' }}> · {m.need}</span>
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--c-text-dim)' }}>{m.sectionTitle}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {evaluation.failedFields.length > 0 && (
                <div style={{ color: 'var(--c-amber)' }}>
                  Failed: {evaluation.failedFields.length}
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {!isPreview && !isCertifiedOrAbandoned && !isVerifier && !readOnlyProp && (
          <Button
            onClick={onSubmit}
            disabled={status === 'awaiting_verification' || submitting}
            style={{ width: '100%' }}
          >
            {status === 'awaiting_verification'
              ? 'Awaiting verification'
              : submitting
                ? 'Submitting…'
                : submitConfirm.armed
                  ? 'Tap again to submit'
                  : 'Submit for verification'}
          </Button>
        )}
        {saveError && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--c-red)' }}>
            {saveError}
          </p>
        )}
        {submitError && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--c-red)' }}>
            {submitError}
          </p>
        )}

        {isVerifier && (
          <Button onClick={() => setShowCertify(true)} style={{ width: '100%' }}>
            Certify / Send back
          </Button>
        )}
      </aside>

      {showCertify && projectId && (
        <CertifyModal
          inspectionId={inspectionId}
          projectId={projectId}
          deliverableType={template.deliverable_type}
          onClose={() => setShowCertify(false)}
        />
      )}
    </div>
    </PhotoTallyContext.Provider>
  )
}
