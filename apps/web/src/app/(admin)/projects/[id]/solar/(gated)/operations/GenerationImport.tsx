'use client'
/**
 * Import generation data (spec §10) through the EXISTING meter pipeline (Phase 3a): upload the raw file
 * to solar-meter-raw by its SHA-256, register it, parse it server-side, commit it as a series to a solar
 * meter. Readings upsert on (channel, interval end) and the Operations aggregation keeps one reading per
 * meter per interval, so importing the same or an overlapping export REPLACES those intervals. Months
 * come from the file's own timestamps.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { sha256Hex } from '@esite/shared/meter-data'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { FormField, Select, TextInput } from '@/components/ui/FormField'
import { linkMeterAction } from '@/actions/solar-operations.actions'

interface Props {
  projectId: string
  organisationId: string
  installationId: string
  generationMeters: Array<{ meterId: string; label: string }>
}
interface Review { fileId: string; outcome: string; canAccept: boolean; blockingErrors: string[]; choicesNeeded: string[] }

const EXT = /\.(csv|txt|xlsx|xls)$/i

function readBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(file)
  })
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, json }
}

export function GenerationImport(p: Props) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [target, setTarget] = useState(p.generationMeters[0]?.meterId ?? 'new')
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null); setProblems([]); setDone(null)
    if (!file) { setError('Choose a file first.'); return }
    const ext = EXT.exec(file.name)?.[1]?.toLowerCase()
    if (!ext) { setError('Choose a .csv, .txt, .xlsx or .xls export.'); return }
    if (target === 'new' && newLabel.trim() === '') { setError('Name the new meter.'); return }
    setBusy(true)
    try {
      const sha = await sha256Hex(await readBytes(file))
      const storagePath = `${p.organisationId}/${p.projectId}/${sha}.${ext}`
      const { error: upErr } = await createClient().storage.from('solar-meter-raw').upload(storagePath, file, { upsert: false })
      if (upErr && !/exist/i.test(upErr.message ?? '')) { setError('The file could not be uploaded — try again.'); return }
      const base = `/api/projects/${p.projectId}/solar/meter-files`
      const reg = await postJson(base, { storagePath, originalName: file.name })
      if (!reg.ok) {
        setError(reg.json.error === 'duplicate_in_other_project' ? 'This exact file is already imported on another project.' : 'The file could not be registered — try again.')
        return
      }
      const fileId = String(reg.json.fileId)
      const parsed = await postJson(`${base}/parse`, { fileIds: [fileId] })
      const review = ((parsed.json.results as Array<{ reviews?: Review[] }> | undefined)?.[0]?.reviews?.[0]) ?? null
      if (!parsed.ok || !review) { setError('The file could not be read.'); return }
      if (review.outcome !== 'series' || !review.canAccept) {
        setProblems([...(review.blockingErrors ?? []), ...(review.choicesNeeded ?? [])])
        if (review.outcome !== 'series') setError('This is not a time series of readings.')
        return
      }
      const meter = target === 'new' ? { new: { label: newLabel.trim(), kind: 'solar' } } : { existingMeterId: target }
      const commit = await postJson(`${base}/commit`, { mode: 'series', fileId, meter, identity: { resolution: 'none' } })
      if (!commit.ok) { setError(typeof commit.json.error === 'string' ? `The import was refused: ${commit.json.error}.` : 'The import failed — try again.'); return }
      const meterId = String(commit.json.meterId)
      if (!p.generationMeters.some((m) => m.meterId === meterId)) {
        const r = await linkMeterAction({ projectId: p.projectId, installationId: p.installationId, meterId, role: 'generation' })
        if ('error' in r) { setError(r.error); return }
      }
      setDone(`Imported to ${String(commit.json.meterLabel ?? 'the meter')}. Months are taken from the file’s own timestamps; re-importing replaces those intervals.`)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <span className="data-panel-title">Import generation data</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <FormField label="Generation file" htmlFor="ops-gen-file">
          <input id="ops-gen-file" type="file" accept=".csv,.txt,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </FormField>
        <FormField label="Into meter" htmlFor="ops-gen-target">
          <Select id="ops-gen-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            {p.generationMeters.map((m) => <option key={m.meterId} value={m.meterId}>{m.label}</option>)}
            <option value="new">New solar meter…</option>
          </Select>
        </FormField>
        {target === 'new' ? (
          <FormField label="New meter name" htmlFor="ops-gen-name">
            <TextInput id="ops-gen-name" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          </FormField>
        ) : null}
        <Button disabled={busy} onClick={run}>Import generation data</Button>
      </div>
      {problems.length > 0 ? (
        <div role="alert">
          <p style={{ fontSize: 13, margin: 0 }}>This file needs attention before it can be imported:</p>
          <ul style={{ fontSize: 13 }}>{problems.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ) : null}
      {error ? <p role="alert" style={{ fontSize: 13, color: 'var(--c-red)', margin: 0 }}>{error}</p> : null}
      {done ? <p role="status" style={{ fontSize: 13, margin: 0 }}>{done}</p> : null}
    </div>
  )
}
