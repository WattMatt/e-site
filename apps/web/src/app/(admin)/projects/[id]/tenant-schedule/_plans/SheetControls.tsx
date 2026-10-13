'use client'

/**
 * Rename, replace or delete the sheet on screen (owner / admin / PM only; the
 * page renders this only when canEdit). Replace keeps the shapes and the
 * scale; the page then shows the "file replaced" banner until someone
 * re-anchors (decision A, spec 2026-10-12). Delete is a two-step confirm
 * (never window.confirm, which Safari suppresses). Props are JSON only.
 */
import { useEffect, useRef, useState } from 'react'
import { TENANT_PLAN_BUCKET, type StatusPlanPurpose } from '@esite/shared/status-plans'
import {
  deleteTenantPlanSheetAction,
  prepareTenantPlanSheetReplaceAction,
  renameTenantPlanSheetAction,
  replaceTenantPlanSheetAction,
} from '@/actions/tenant-plan-sheets.actions'
import { createClient } from '@/lib/supabase/client'
import { tenantPlanHref } from '@/lib/status-plans/plan-urls'
import { navigateTo } from '@/lib/status-plans/navigate'
import { readUploadBytes, uploadFailedMessage } from '@/lib/status-plans/upload-file'
import { captureError } from '@/lib/sentry'
import type { PlanSheet, SheetSummary } from '@/lib/status-plans/types'

export interface SheetControlsProps {
  projectId: string
  purpose: StatusPlanPurpose
  sheet: PlanSheet
  /** Shapes on this sheet: deleting the sheet deletes them. */
  shapeCount: number
  onChanged: (sheet: SheetSummary) => void
}

const ARM_MS = 4000
const NO_ANSWER = 'The server did not answer. Check your connection and try again.'

export function SheetControls({ projectId, purpose, sheet, shapeCount, onChanged }: SheetControlsProps) {
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(sheet.label)
  const [page, setPage] = useState(String(sheet.pageIndex))
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), ARM_MS)
    return () => clearTimeout(t)
  }, [armed])

  async function guarded(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try { await fn() } catch { setError(NO_ANSWER) } finally { setBusy(false) }
  }

  const rename = () => guarded(async () => {
    const res = await renameTenantPlanSheetAction({ sheetId: sheet.id, expectedUpdatedAt: sheet.updatedAt, label: draft })
    if (!res.ok) { setError(res.error); return }
    onChanged(res.data)
    setRenaming(false)
  })

  const replace = (file: File) => guarded(async () => {
    const read = await readUploadBytes(file, file.type || 'application/octet-stream')
    if (!read.ok) {
      captureError(read.cause ?? new Error('tenant plan file unreadable'), { stage: 'tenant-plan-read', file: file.name, size: file.size })
      setError(read.error)
      return
    }
    const prep = await prepareTenantPlanSheetReplaceAction({ sheetId: sheet.id, file: { name: file.name, size: read.blob.size, type: file.type } })
    if (!prep.ok) { setError(prep.error); return }
    const body = new Blob([read.blob], { type: prep.data.mime })
    const { error: upErr } = await createClient().storage.from(TENANT_PLAN_BUCKET)
      .uploadToSignedUrl(prep.data.path, prep.data.token, body, { contentType: prep.data.mime })
    if (upErr) {
      captureError(upErr, { stage: 'tenant-plan-replace', file: file.name, size: body.size })
      setError(uploadFailedMessage(file.name, upErr))
      return
    }
    const res = await replaceTenantPlanSheetAction({
      sheetId: sheet.id, expectedUpdatedAt: sheet.updatedAt, path: prep.data.path, fileName: file.name,
      mime: prep.data.mime, pageIndex: Math.max(1, Number.parseInt(page, 10) || 1),
    })
    if (!res.ok) { setError(res.error); return }
    navigateTo(tenantPlanHref(projectId, purpose, { sheet: sheet.id }))
  })

  function remove() {
    if (!armed) { setArmed(true); return }
    setArmed(false)
    void guarded(async () => {
      const res = await deleteTenantPlanSheetAction({ sheetId: sheet.id, expectedUpdatedAt: sheet.updatedAt })
      if (!res.ok) { setError(res.error); return }
      navigateTo(tenantPlanHref(projectId, purpose))
    })
  }

  const armedLabel = `Press again to delete this sheet${shapeCount > 0 ? ` and its ${shapeCount} shape${shapeCount === 1 ? '' : 's'}` : ''}`

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
      {renaming ? (
        <>
          <input className="ob-input" aria-label="Sheet name" value={draft} maxLength={120} onChange={(e) => setDraft(e.target.value)} />
          <button type="button" className="btn-primary-amber" disabled={busy} onClick={() => void rename()}>Save</button>
          <button type="button" onClick={() => { setRenaming(false); setDraft(sheet.label) }}>Cancel</button>
        </>
      ) : (
        <button type="button" disabled={busy} onClick={() => setRenaming(true)}>Rename</button>
      )}

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        Page in the new file
        <input
          type="number" min={1} step={1} className="ob-input compact-field" style={{ width: 64 }}
          aria-label="Page in the new file" value={page} onChange={(e) => setPage(e.target.value)}
        />
      </label>
      <input
        ref={fileInput} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        aria-label="Choose the replacement file"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void replace(f) }}
      />
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>Replace file</button>

      <button type="button" disabled={busy} onClick={remove} style={{ color: '#dc2626', fontWeight: armed ? 700 : 400 }}>
        {armed ? armedLabel : 'Delete sheet'}
      </button>

      {error && <span role="alert" style={{ color: '#dc2626' }}>{error}</span>}
    </div>
  )
}
