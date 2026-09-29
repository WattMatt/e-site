'use client'
/**
 * Import generation data (spec §10) through the EXISTING meter pipeline (Phase 3a): upload the raw file
 * to solar-meter-raw by its SHA-256, register it, parse it server-side, commit it as a series to a solar
 * meter. Readings upsert on (channel, interval end) and the Operations aggregation drops any reading a
 * newer file of the same meter overlaps, so importing the same or an overlapping export REPLACES those
 * intervals, at any interval. Months come from the file's own timestamps.
 *
 * When the parser needs a choice (date order, timestamp convention, a column's unit) the choice is
 * asked for HERE (review B3): the answers go to the parse route as options, and the same options go to
 * the commit, so what was previewed is what is stored. Phase 3a has no other import surface to send
 * the user to.
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
interface ChannelInfo { column: string; sourceUnit: string; suggestedUnit: string | null }
interface Review { fileId: string; outcome: string; canAccept: boolean; blockingErrors: string[]; choicesNeeded: string[]; channels?: ChannelInfo[] }
interface ParseOptions { dateOrder?: 'DMY' | 'MDY' | 'YMD'; tsConvention?: 'begin' | 'end'; units?: Record<string, string> }
interface Pending { fileId: string; review: Review }

const EXT = /\.(csv|txt|xlsx|xls)$/i
/** Generation is power or energy; the parser converts either to stored kW. */
const GEN_UNITS = ['kW', 'W', 'MW', 'kWh', 'Wh', 'MWh'] as const
const CHOICE_LABELS: Record<string, string> = {
  ambiguous_date_order: 'The dates could be read day-first or month-first — choose the date order.',
  convention_required: 'The file does not say whether a timestamp marks the start or the end of its interval — choose one.',
  unknown_unit: 'A column has no unit — choose it.',
}

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

const unknownColumns = (r: Review) => (r.channels ?? []).filter((c) => c.sourceUnit === 'unknown')

export function GenerationImport(p: Props) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [target, setTarget] = useState(p.generationMeters[0]?.meterId ?? 'new')
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [dateOrder, setDateOrder] = useState('')
  const [convention, setConvention] = useState('')
  const [units, setUnits] = useState<Record<string, string>>({})

  const base = `/api/projects/${p.projectId}/solar/meter-files`

  function needChoices(fileId: string, review: Review) {
    setPending({ fileId, review })
    setUnits(Object.fromEntries(unknownColumns(review).map((c) => [c.column, c.suggestedUnit && (GEN_UNITS as readonly string[]).includes(c.suggestedUnit) ? c.suggestedUnit : ''])))
  }

  /** Parse (optionally with answers); commit when the parser accepts the file, else ask or explain. */
  async function parseAndCommit(fileId: string, options: ParseOptions | null) {
    const parsed = await postJson(`${base}/parse`, options ? { fileIds: [fileId], options: { [fileId]: options } } : { fileIds: [fileId] })
    const review = ((parsed.json.results as Array<{ reviews?: Review[] }> | undefined)?.[0]?.reviews?.[0]) ?? null
    if (!parsed.ok || !review) { setError('The file could not be read.'); return }
    if (review.outcome !== 'series') {
      setProblems(review.blockingErrors ?? [])
      setError('This is not a time series of readings.')
      return
    }
    if (!review.canAccept) {
      const blocking = review.blockingErrors ?? []
      // Only choices left: ask for them in place. Anything else is explained and stops.
      if (blocking.length === 0 && (review.choicesNeeded ?? []).length > 0) { needChoices(fileId, review); return }
      setProblems([...blocking, ...(review.choicesNeeded ?? []).map((c) => CHOICE_LABELS[c] ?? c)])
      return
    }
    setPending(null)
    const meter = target === 'new' ? { new: { label: newLabel.trim(), kind: 'solar' } } : { existingMeterId: target }
    const commit = await postJson(`${base}/commit`, { mode: 'series', fileId, meter, identity: { resolution: 'none' }, ...(options ? { options } : {}) })
    if (!commit.ok) { setError(typeof commit.json.error === 'string' ? `The import was refused: ${commit.json.error}.` : 'The import failed — try again.'); return }
    const meterId = String(commit.json.meterId)
    if (!p.generationMeters.some((m) => m.meterId === meterId)) {
      const r = await linkMeterAction({ projectId: p.projectId, installationId: p.installationId, meterId, role: 'generation' })
      if ('error' in r) { setError(r.error); return }
    }
    setDone(`Imported to ${String(commit.json.meterLabel ?? 'the meter')}. Months are taken from the file’s own timestamps; re-importing replaces those intervals.`)
    router.refresh()
  }

  async function run() {
    setError(null); setProblems([]); setDone(null); setPending(null)
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
      const reg = await postJson(base, { storagePath, originalName: file.name })
      if (!reg.ok) {
        setError(reg.json.error === 'duplicate_in_other_project' ? 'This exact file is already imported on another project.' : 'The file could not be registered — try again.')
        return
      }
      await parseAndCommit(String(reg.json.fileId), null)
    } finally {
      setBusy(false)
    }
  }

  async function answer() {
    if (!pending) return
    setError(null)
    const needs = new Set(pending.review.choicesNeeded)
    const options: ParseOptions = {}
    if (needs.has('ambiguous_date_order')) {
      if (dateOrder !== 'DMY' && dateOrder !== 'MDY' && dateOrder !== 'YMD') { setError('Choose the date order.'); return }
      options.dateOrder = dateOrder
    }
    if (needs.has('convention_required')) {
      if (convention !== 'begin' && convention !== 'end') { setError('Choose whether a timestamp marks the start or the end of its interval.'); return }
      options.tsConvention = convention
    }
    if (needs.has('unknown_unit')) {
      const cols = unknownColumns(pending.review)
      if (cols.some((c) => !units[c.column])) { setError('Choose a unit for every column without one.'); return }
      options.units = Object.fromEntries(cols.map((c) => [c.column, units[c.column]!]))
    }
    setBusy(true)
    try {
      await parseAndCommit(pending.fileId, options)
    } finally {
      setBusy(false)
    }
  }

  const needs = new Set(pending?.review.choicesNeeded ?? [])
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <span className="data-panel-title">Import generation data</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <FormField label="Generation file" htmlFor="ops-gen-file">
          <input id="ops-gen-file" type="file" accept=".csv,.txt,.xlsx,.xls" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPending(null) }} />
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
      {pending ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={{ fontSize: 13, margin: 0 }}>The file was read, but it needs your answer before it can be imported:</p>
          <ul style={{ fontSize: 13, margin: 0 }}>{[...needs].map((c) => <li key={c}>{CHOICE_LABELS[c] ?? c}</li>)}</ul>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {needs.has('ambiguous_date_order') ? (
              <FormField label="Date order" htmlFor="ops-gen-dateorder">
                <Select id="ops-gen-dateorder" value={dateOrder} onChange={(e) => setDateOrder(e.target.value)}>
                  <option value="">Choose…</option>
                  <option value="DMY">Day / month / year</option>
                  <option value="MDY">Month / day / year</option>
                  <option value="YMD">Year / month / day</option>
                </Select>
              </FormField>
            ) : null}
            {needs.has('convention_required') ? (
              <FormField label="Timestamps mark the" htmlFor="ops-gen-convention">
                <Select id="ops-gen-convention" value={convention} onChange={(e) => setConvention(e.target.value)}>
                  <option value="">Choose…</option>
                  <option value="begin">Start of each interval</option>
                  <option value="end">End of each interval</option>
                </Select>
              </FormField>
            ) : null}
            {needs.has('unknown_unit') ? unknownColumns(pending.review).map((c, k) => (
              <FormField key={c.column} label={`Unit of column "${c.column}"`} htmlFor={`ops-gen-unit-${k}`}>
                <Select id={`ops-gen-unit-${k}`} value={units[c.column] ?? ''} onChange={(e) => setUnits((u) => ({ ...u, [c.column]: e.target.value }))}>
                  <option value="">Choose…</option>
                  {GEN_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </Select>
              </FormField>
            )) : null}
            <Button disabled={busy} onClick={answer}>Import with these choices</Button>
          </div>
        </div>
      ) : null}
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
