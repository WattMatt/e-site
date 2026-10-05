'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { getTenderUploadUrlAction, importTenderAction } from '@/actions/tender.actions'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function upload(tenderId: string, kind: 'source' | 'estimate', file: File): Promise<{ path: string } | { error: string }> {
  const signed = await getTenderUploadUrlAction(tenderId, kind, file.name)
  if ('error' in signed) return signed
  const { error } = await createClient()
    .storage.from('tender-files')
    .uploadToSignedUrl(signed.data.path, signed.data.token, file, { contentType: file.type || XLSX })
  if (error) return { error: `Uploading ${file.name} failed. Try again.` }
  return { path: signed.data.path }
}

export function ImportPanel({ tenderId, hasImport }: { tenderId: string; hasImport: boolean }) {
  const router = useRouter()
  const [source, setSource] = useState<File | null>(null)
  const [estimate, setEstimate] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function run() {
    if (!source) return setMsg({ ok: false, text: 'Choose the tender BOQ workbook' })
    setBusy(true)
    setMsg(null)
    try {
      const s = await upload(tenderId, 'source', source)
      if ('error' in s) return setMsg({ ok: false, text: s.error })
      let e: { path: string } | null = null
      if (estimate) {
        const r = await upload(tenderId, 'estimate', estimate)
        if ('error' in r) return setMsg({ ok: false, text: r.error })
        e = r
      }
      const res = await importTenderAction(tenderId, {
        sourcePath: s.path,
        sourceFilename: source.name,
        estimatePath: e?.path ?? null,
        estimateFilename: estimate?.name ?? null,
      })
      if ('error' in res) return setMsg({ ok: false, text: res.error })
      setMsg({
        ok: res.data.matched,
        text: res.data.matched
          ? `Imported ${res.data.items} items. Everything reconciles to the cent.`
          : `Imported ${res.data.items} items. Some checks do not reconcile — see the report below.`,
      })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader><span className="data-panel-title">{hasImport ? 'Re-import (replaces the BOQ)' : 'Import BOQ'}</span></CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <label>Tender BOQ workbook (as issued to tenderers)
            <input type="file" accept=".xlsx,.xlsm" onChange={(e) => setSource(e.target.files?.[0] ?? null)} />
          </label>
          <label>Internal estimate (PRE-PRICED INTERNAL, optional)
            <input type="file" accept=".xlsx,.xlsm" onChange={(e) => setEstimate(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: '8px 0 0' }}>
          The estimate is visible only to owners, admins and project managers. Tenderers never see it.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <Button isLoading={busy} onClick={run} disabled={!source}>Import and reconcile</Button>
          {msg && <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</span>}
        </div>
      </CardBody>
    </Card>
  )
}
