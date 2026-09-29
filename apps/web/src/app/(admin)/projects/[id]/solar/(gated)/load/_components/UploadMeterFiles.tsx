'use client'
/**
 * "Upload meter files" / "Import meter register" (spec §4.3): multi-file picker + drop zone. Each file is
 * hashed in the browser, uploaded DIRECTLY to Storage at <org>/<project>/<sha256>.<ext> (never through a
 * Vercel function), registered, then parsed server-side; the reviews go to the import dialog.
 */
import { useId, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ensureSolarStudyAction } from '@/actions/solar-load.actions'
import type { ReviewModel } from '@/lib/solar/meter-import/review'
import { MAX_UPLOAD_BYTES, METER_UPLOAD_RE, parseFiles, rawPath, registerRawFile, sha256OfBlob } from '@/lib/solar/load/import-client'

type Uploader = (path: string, file: File) => Promise<string | null>

const defaultUpload: Uploader = async (path, file) => {
  const { error } = await createClient().storage.from('solar-meter-raw').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
  if (!error) return null
  return /exist|duplicate/i.test(error.message) ? null : 'The upload failed — try again.'
}

export function UploadMeterFiles({ projectId, orgId, label, accept, onReviews, upload = defaultUpload, hash = sha256OfBlob }: {
  projectId: string; orgId: string; label: string; accept: string; onReviews: (r: ReviewModel[]) => void
  upload?: Uploader; hash?: (f: File) => Promise<string>
}) {
  const inputId = useId()
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [over, setOver] = useState(false)

  async function handle(files: File[]) {
    if (files.length === 0) return
    setBusy(true)
    const out: string[] = []
    const ids: string[] = []
    const ensured = await ensureSolarStudyAction(projectId)
    if ('error' in ensured) { setLines([ensured.error]); setBusy(false); return }
    for (const f of files) {
      if (!METER_UPLOAD_RE.test(f.name)) { out.push(`${f.name}: only .csv, .txt, .xlsx or .xls meter exports can be imported.`); continue }
      if (f.size > MAX_UPLOAD_BYTES) { out.push(`${f.name}: larger than 50 MB.`); continue }
      out.push(`${f.name}: uploading…`)
      setLines([...out])
      const sha = await hash(f)
      const path = rawPath(orgId, projectId, sha, f.name) as string
      const upErr = await upload(path, f)
      if (upErr) { out[out.length - 1] = `${f.name}: ${upErr}`; continue }
      const reg = await registerRawFile(projectId, path, f.name)
      if (!reg.ok) { out[out.length - 1] = `${f.name}: ${reg.message}`; continue }
      ids.push(reg.fileId)
      out[out.length - 1] = `${f.name}: ${reg.duplicate ? 'already uploaded — reviewing again' : 'uploaded'}`
    }
    setLines([...out])
    if (ids.length > 0) {
      const parsed = await parseFiles(projectId, ids)
      for (const x of parsed.failed) out.push(x.message)
      setLines([...out])
      if (parsed.reviews.length > 0) onReviews(parsed.reviews)
    }
    setBusy(false)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void handle(Array.from(e.dataTransfer.files)) }}
      style={{ border: `1px dashed ${over ? 'var(--c-amber)' : 'var(--c-border)'}`, borderRadius: 8, padding: 10 }}
    >
      <label htmlFor={inputId} style={{ cursor: busy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600 }}>{busy ? 'Working…' : label}</label>
      <input id={inputId} type="file" multiple accept={accept} disabled={busy} aria-label={label}
        onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; void handle(fs) }}
        style={{ marginLeft: 8, fontSize: 12 }} />
      <span style={{ fontSize: 12, color: 'var(--c-text-dim)', marginLeft: 8 }}>or drop files here · ≤ 50 MB each</span>
      {lines.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  )
}
