'use client'
/**
 * Upload a tariff source (spec §12): hash in the browser, upload straight to
 * the private bucket through a signed upload URL, then the server re-hashes
 * and registers it. Never posts the file through a server function.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SOURCE_DOCUMENT_KINDS, SOURCE_DOCUMENT_KIND_LABELS, SOURCE_DOCUMENT_STATUSES, SOURCE_DOCUMENT_STATUS_LABELS } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { sha256Hex } from '@/lib/tariffs/sha256'
import { contentTypeFor } from '@/lib/tariffs/source-files'
import { createSourceUploadAction, registerSourceDocumentAction } from '@/actions/tariff-library.actions'

export function SourceUpload({ licensees }: { licensees: Array<{ id: string; name: string }> }) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState('nersa_decision')
  const [title, setTitle] = useState('')
  const [fy, setFy] = useState('')
  const [status, setStatus] = useState('nersa_approved')
  const [licenseeId, setLicenseeId] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function upload() {
    if (!file) return setMsg({ ok: false, text: 'Choose a file' })
    const type = contentTypeFor(file.name)
    if (!type) return setMsg({ ok: false, text: 'Upload a PDF, XLSX or XLSM file' })
    setBusy(true); setMsg(null)
    try {
      const sha256 = await sha256Hex(await file.arrayBuffer())
      const meta = { fileName: file.name, sha256, size: file.size, kind, title, financialYear: fy, status, licenseeId: licenseeId || null, publishedOn: '', url }
      const signed = await createSourceUploadAction(meta)
      if ('error' in signed) return setMsg({ ok: false, text: signed.error })
      const { error } = await createClient().storage.from('tariff-sources').uploadToSignedUrl(signed.path, signed.token, file, { contentType: type })
      if (error) return setMsg({ ok: false, text: 'The upload failed. Try again.' })
      const reg = await registerSourceDocumentAction(meta)
      if ('error' in reg) return setMsg({ ok: false, text: reg.error })
      setMsg({ ok: true, text: 'Uploaded and registered.' })
      setFile(null); setTitle('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader><span className="data-panel-title">Upload source</span></CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <label>File (PDF, XLSX, XLSM, up to 50 MB)<input type="file" accept=".pdf,.xlsx,.xlsm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <label>Kind<select value={kind} onChange={(e) => setKind(e.target.value)}>{SOURCE_DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{SOURCE_DOCUMENT_KIND_LABELS[k]}</option>)}</select></label>
          <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="City Power RfD 2026/27" /></label>
          <label>Financial year<input value={fy} onChange={(e) => setFy(e.target.value)} placeholder="2026/27" /></label>
          <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>{SOURCE_DOCUMENT_STATUSES.map((s) => <option key={s} value={s}>{SOURCE_DOCUMENT_STATUS_LABELS[s]}</option>)}</select></label>
          <label>Licensee (one-licensee documents)<select value={licenseeId} onChange={(e) => setLicenseeId(e.target.value)}>
            <option value="">Many / not specific</option>{licensees.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></label>
          <label>Source link (optional)<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <Button isLoading={busy} onClick={upload}>Upload source</Button>
          {msg && <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</span>}
        </div>
      </CardBody>
    </Card>
  )
}
