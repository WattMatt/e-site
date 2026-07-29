'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  updateQcEntrySchema,
  type QcConformance,
  type QcSeverity,
} from '@esite/shared'
import { updateQcEntryAction } from '@/actions/qc.actions'
import { Button } from '@/components/ui/Button'
import { ConformanceRadioGroup, SeveritySelect } from '../ConformanceInputs'

interface Props {
  entryId: string
  /** Entry's 1-based number — disambiguates the ✎ toggle's accessible name. */
  entryNumber: number
  defaultValues: {
    title: string
    description?: string
    conformance: QcConformance
    severity?: QcSeverity | null
  }
}

/**
 * Inline edit of a QC entry's title / description / conformance / severity via
 * updateQcEntryAction — the EditQcReportForm toggle pattern, reusing the shared
 * conformance segmented control. Controlled useState (the conformance radiogroup
 * isn't a native input, so react-hook-form's register can't drive it); the
 * shared updateQcEntrySchema is the client-side validator, so the "severity ⇔
 * fail" rule matches the server action exactly. The parent only renders this for
 * QC_WRITE_ROLES on non-closed reports (the action re-gates + freezes closed).
 */
export function EditQcEntryForm({ entryId, entryNumber, defaultValues }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(defaultValues.title)
  const [description, setDescription] = useState(defaultValues.description ?? '')
  const [conformance, setConformance] = useState<QcConformance>(defaultValues.conformance)
  const [severity, setSeverity] = useState<QcSeverity | ''>(defaultValues.severity ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function reset() {
    setTitle(defaultValues.title)
    setDescription(defaultValues.description ?? '')
    setConformance(defaultValues.conformance)
    setSeverity(defaultValues.severity ?? '')
    setError(null)
  }

  function close() {
    setOpen(false)
    reset()
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)

    const parsed = updateQcEntrySchema.safeParse({
      entryId,
      title: title.trim(),
      description: description.trim() || undefined,
      conformance,
      severity: conformance === 'fail' ? (severity || undefined) : undefined,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input')
      return
    }

    setSaving(true)
    const result = await updateQcEntryAction(parsed.data)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setOpen(false)
    startTransition(() => router.refresh())
  }

  if (!open) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpen(true)}
          aria-label={`Edit entry ${entryNumber}`}
        >
          ✎ Edit entry
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border-mid)',
        borderRadius: 8,
        padding: '16px 18px',
        marginBottom: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--c-text-mid)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Edit entry
        </span>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 16, padding: 4, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {error && <p role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}

      <div>
        <label className="ob-label" htmlFor={`qc-edit-title-${entryId}`}>Title *</label>
        <input
          id={`qc-edit-title-${entryId}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="ob-input"
          style={{ marginTop: 4 }}
        />
      </div>

      <div>
        <label className="ob-label" htmlFor={`qc-edit-desc-${entryId}`}>Description</label>
        <textarea
          id={`qc-edit-desc-${entryId}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="ob-input"
          style={{ marginTop: 4, resize: 'vertical' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <ConformanceRadioGroup
          value={conformance}
          name={`qc-edit-conf-${entryId}`}
          onChange={(v) => {
            setConformance(v)
            if (v !== 'fail') setSeverity('')
          }}
        />
        {conformance === 'fail' && (
          <SeveritySelect id={`qc-edit-severity-${entryId}`} value={severity} onChange={setSeverity} />
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Button type="button" variant="ghost" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" isLoading={saving} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
