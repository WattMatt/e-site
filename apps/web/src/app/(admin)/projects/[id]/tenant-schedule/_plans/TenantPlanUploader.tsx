'use client'

/**
 * Upload one or more files to a tenant plan (spec 2026-10-12 §3). The browser
 * uploads straight to the private bucket with server-issued signed URLs, so a
 * 50 MB A0 never passes through a Vercel function; the server then registers
 * the sheets (a PDF of N pages becomes N sheets, files appended in order).
 * Props are strings only.
 */
import { useRef, useState } from 'react'
import { TENANT_PLAN_BUCKET, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { prepareTenantPlanUploadAction, registerTenantPlanSheetsAction } from '@/actions/tenant-plan-sheets.actions'
import { createClient } from '@/lib/supabase/client'
import { tenantPlanHref } from '@/lib/status-plans/plan-urls'
import { navigateTo } from '@/lib/status-plans/navigate'
import { readUploadBytes, uploadFailedMessage } from '@/lib/status-plans/upload-file'
import { captureError } from '@/lib/sentry'

export interface TenantPlanUploaderProps {
  projectId: string
  purpose: StatusPlanPurpose
  label?: string
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'
const NO_ANSWER = 'The server did not answer. Check your connection and try again.'

export function TenantPlanUploader({ projectId, purpose, label = 'Upload' }: TenantPlanUploaderProps) {
  const input = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function upload(files: File[]) {
    if (files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      // Read every file first: an online-only placeholder must be refused
      // before a plan or an upload URL is created for it.
      setStatus(`Reading ${files.length} file${files.length === 1 ? '' : 's'}…`)
      const blobs: Blob[] = []
      for (const f of files) {
        const read = await readUploadBytes(f, f.type || 'application/octet-stream')
        if (!read.ok) {
          captureError(read.cause ?? new Error('tenant plan file unreadable'), { stage: 'tenant-plan-read', file: f.name, size: f.size })
          setError(read.error)
          return
        }
        blobs.push(read.blob)
      }

      setStatus(`Preparing ${files.length} file${files.length === 1 ? '' : 's'}…`)
      const prep = await prepareTenantPlanUploadAction({
        projectId, purpose, files: files.map((f, i) => ({ name: f.name, size: blobs[i]!.size, type: f.type })),
      })
      if (!prep.ok) { setError(prep.error); return }

      const storage = createClient().storage.from(TENANT_PLAN_BUCKET)
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!
        const u = prep.data.uploads[i]!
        setStatus(`Uploading ${f.name} (${i + 1} of ${files.length})…`)
        const body = new Blob([blobs[i]!], { type: u.mime })
        const { error: upErr } = await storage.uploadToSignedUrl(u.path, u.token, body, { contentType: u.mime })
        if (upErr) {
          captureError(upErr, { stage: 'tenant-plan-upload', file: f.name, size: body.size })
          setError(uploadFailedMessage(f.name, upErr))
          return
        }
      }

      setStatus('Reading the sheets…')
      const reg = await registerTenantPlanSheetsAction({
        planId: prep.data.planId,
        files: files.map((f, i) => ({ path: prep.data.uploads[i]!.path, fileName: f.name, mime: prep.data.uploads[i]!.mime })),
      })
      if (!reg.ok) { setError(reg.error); return }
      navigateTo(tenantPlanHref(projectId, purpose, { sheet: reg.data.sheets[0]?.id ?? null }))
    } catch {
      setError(NO_ANSWER)
    } finally {
      setBusy(false)
      setStatus(null)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        aria-label="Choose files to upload"
        hidden
        onChange={(e) => void upload(Array.from(e.target.files ?? []))}
      />
      <button type="button" className="btn-primary-amber" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Uploading…' : label}
      </button>
      {status && <span role="status" style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{status}</span>}
      {error && <span role="alert" style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
    </span>
  )
}
