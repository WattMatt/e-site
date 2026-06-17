'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { evaluateInspection, isFieldVisible } from '@esite/shared'
import type { Template, Response as InspectionResponse, Section, SubSection, Field } from '@esite/shared'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { upsertResponseAction, submitInspectionAction } from '@/actions/inspections.actions'
import FieldRenderer from './FieldRenderer'
import CertifyModal from './CertifyModal'

type Mode = 'capture' | 'preview'

interface Props {
  inspectionId: string
  projectId?: string
  template: Template
  initialResponses: InspectionResponse[]
  initialPhotos?: { section_id: string; field_id: string }[]
  status?: string
  verifierId?: string | null
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
  status,
  verifierId,
  currentUserId,
  mode,
  readOnly: readOnlyProp,
}: Props) {
  const [responses, setResponses] = useState<InspectionResponse[]>(initialResponses)
  // Photos are loaded server-side (no client-side mutation surface in this commit).
  // signature_required validation is deferred — see page.tsx comment above the query.
  const photos = initialPhotos ?? []
  const [activeSection, setActiveSection] = useState<string>(template.sections[0]?.section_id ?? '')
  const [savingFields, setSavingFields] = useState<Set<string>>(new Set())
  const [showCertify, setShowCertify] = useState(false)
  const debouncers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const isPreview = mode === 'preview'
  const isCertifiedOrAbandoned = status === 'certified' || status === 'abandoned'
  const isVerifier =
    currentUserId !== null && verifierId === currentUserId && status === 'awaiting_verification'
  const readOnly =
    readOnlyProp || isPreview || isCertifiedOrAbandoned || status === 'awaiting_verification'

  const evaluation = useMemo(
    () => evaluateInspection(template, responses, { photos }),
    [template, responses, photos],
  )

  const sectionStats = useMemo(() => {
    const stats = new Map<string, { answered: number; total: number; missing: number }>()
    const tally = (s: Section, f: Field, subsection: SubSection | undefined, acc: { total: number; answered: number; missing: number }) => {
      if (f.type === 'header' || f.type === 'computed') return
      if (!isFieldVisible(f, responses, { section: s, subsection })) return
      acc.total++
      const r = responses.find((rr) => rr.section_id === s.section_id && rr.field_id === f.field_id)
      const has =
        r &&
        (r.value_bool != null ||
          r.value_number != null ||
          (r.value_text?.length ?? 0) > 0 ||
          (r.value_array?.length ?? 0) > 0)
      if (has) acc.answered++
      else if (f.required) acc.missing++
    }
    for (const s of template.sections) {
      const acc = { total: 0, answered: 0, missing: 0 }
      for (const f of s.fields ?? []) tally(s, f, undefined, acc)
      for (const ss of s.subsections ?? []) {
        for (const f of ss.fields) tally(s, f, ss, acc)
      }
      stats.set(s.section_id, acc)
    }
    return stats
  }, [template, responses])

  const updateResponse = useCallback(
    (sectionId: string, fieldId: string, patch: Partial<InspectionResponse>) => {
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

      const key = `${sectionId}:${fieldId}`
      const existing = debouncers.current.get(key)
      if (existing) clearTimeout(existing)

      debouncers.current.set(
        key,
        setTimeout(async () => {
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
          } finally {
            setSavingFields((prev) => {
              const n = new Set(prev)
              n.delete(key)
              return n
            })
          }
        }, 800),
      )
    },
    [inspectionId, isPreview],
  )

  // Seed template default_value into responses once on mount, so a field's
  // default is both shown AND persisted to the DB (the fill widgets only show
  // defaults; without this, an untouched default never lands in inspections.
  // responses). Repeating-group sub-fields are seeded per entry by their own
  // widgets, not here. Runs once; skipped in read-only/preview.
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
        updateResponse(sectionId, f.field_id, { value_number: f.default_value })
      } else {
        updateResponse(sectionId, f.field_id, { value_text: String(f.default_value) })
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
      setActiveSection(first.sectionId)
      const el = document.getElementById(`field-${first.sectionId}-${first.fieldId}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.classList.add('ring-required')
      setTimeout(() => el?.classList.remove('ring-required'), 2500)
      return
    }
    if (!confirm('Submit inspection for verification?')) return
    if (!projectId) return
    await submitInspectionAction(inspectionId, projectId)
  }

  const section = template.sections.find((s) => s.section_id === activeSection)

  const overallVariant: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'ghost' =
    evaluation.overallResult === 'pass'
      ? 'success'
      : evaluation.overallResult === 'fail'
        ? 'danger'
        : 'warning'

  return (
    <div
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
          const st = sectionStats.get(s.section_id) ?? { answered: 0, total: 0, missing: 0 }
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
                      readOnly={readOnly && !isVerifier}
                      verifierFlipMode={isVerifier}
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
                            readOnly={readOnly && !isVerifier}
                            verifierFlipMode={isVerifier}
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
              {evaluation.missingRequired.length > 0 && (
                <div style={{ color: 'var(--c-red)' }}>
                  Required missing: {evaluation.missingRequired.length}
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

        {!isPreview && !isCertifiedOrAbandoned && !isVerifier && (
          <Button
            onClick={onSubmit}
            disabled={status === 'awaiting_verification'}
            style={{ width: '100%' }}
          >
            {status === 'awaiting_verification' ? 'Awaiting verification' : 'Submit for verification'}
          </Button>
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
  )
}
