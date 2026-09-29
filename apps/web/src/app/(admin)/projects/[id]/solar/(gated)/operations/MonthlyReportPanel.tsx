'use client'
/**
 * Monthly client report (spec §10), Edit + financials only. Commentary is stored per section and month
 * (solar.monthly_report_notes) — typing never freezes a number (WM M1). Generate freezes a snapshot and
 * a PDF as a NEW version; earlier versions are listed and never edited.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { monthLabel, NOTE_SECTION_LABELS, NOTE_SECTIONS, type NoteSection } from '@esite/shared/solar-operations/client'
import type { OpsMonthlyView } from '@/lib/solar/operations/data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, TextInput, Textarea } from '@/components/ui/FormField'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import { generateSolarMonthlyReportAction, saveMonthlyReportNoteAction } from '@/actions/solar-monthly-report.actions'

interface Props { projectId: string; installationId: string; month: string | null; monthly: OpsMonthlyView }

function NoteField({ p, month, section }: { p: Props; month: string; section: NoteSection }) {
  const [body, setBody] = useState(p.monthly.notes[section])
  const [updatedAt, setUpdatedAt] = useState<string | null>(p.monthly.notesUpdatedAt[section])
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const label = NOTE_SECTION_LABELS[section]
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <FormField label={label} htmlFor={`note-${section}`}>
        <Textarea id={`note-${section}`} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      </FormField>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {/* Disabled while saving: a second press would carry the same (now stale) version (review B9). */}
        <Button size="sm" variant="secondary" aria-label={`Save ${label}`} disabled={saving} onClick={async () => {
          if (saving) return
          setSaving(true)
          try {
            const r = await saveMonthlyReportNoteAction({ projectId: p.projectId, installationId: p.installationId, month, section, body, expectedUpdatedAt: updatedAt })
            if ('error' in r) { setMsg(r.error); return }
            setUpdatedAt(r.updatedAt)
            setMsg('Saved.')
          } finally {
            setSaving(false)
          }
        }}>Save</Button>
        {msg ? <span role="status" style={{ fontSize: 12 }}>{msg}</span> : null}
      </div>
    </div>
  )
}

export function MonthlyReportPanel(p: Props) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reason = p.monthly.generateReason
  const month = p.month
  return (
    <Card>
      <CardHeader><span className="data-panel-title">{month ? `Monthly report — ${monthLabel(month)}` : 'Monthly report'}</span></CardHeader>
      <CardBody>
        {reason ? <p role="note" style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 0 }}>{reason}</p> : null}
        {p.monthly.tariffName ? <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 0 }}>{`Lost revenue is valued at ${p.monthly.tariffName} time-of-use rates.`}</p> : null}
        {month ? (
          <>
            <div style={{ display: 'grid', gap: 12 }}>
              {NOTE_SECTIONS.map((s) => <NoteField key={`${month}-${s}`} p={p} month={month} section={s} />)}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 16 }}>
              <FormField label="Revision note" htmlFor="monthly-note"><TextInput id="monthly-note" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
              <Button disabled={busy || reason !== null} onClick={async () => {
                setBusy(true)
                const r = await generateSolarMonthlyReportAction({ projectId: p.projectId, month, note })
                setBusy(false)
                if ('error' in r) { setMsg(r.error); return }
                setMsg(r.warning ? `Version ${r.version} saved. ${r.warning}` : `Version ${r.version} saved.`)
                setNote('')
                setReloadKey((k) => k + 1)
                router.refresh()
              }}>{`Generate report for ${monthLabel(month)}`}</Button>
            </div>
            {msg ? <p role="status" style={{ fontSize: 13 }}>{msg}</p> : null}
          </>
        ) : null}
        <div style={{ marginTop: 16 }}>
          <SavedReportsPanel projectId={p.projectId} kind="solar_monthly" source={{ table: 'solar.installations', id: p.installationId }}
            canManage={false} title="Monthly reports" reloadKey={reloadKey} />
        </div>
      </CardBody>
    </Card>
  )
}
