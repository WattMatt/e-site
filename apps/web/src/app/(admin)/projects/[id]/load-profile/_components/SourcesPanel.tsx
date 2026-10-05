'use client'
/**
 * Sources: imported meter channels and synthetic blocks, each with its data-quality figures.
 * Upload: hashed in the browser, uploaded straight to Storage (never through a Vercel function),
 * then parsed and committed by server actions that re-parse the stored file.
 */
import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  addLibraryMetersAction, addSyntheticSourceAction, commitLoadProfileFileAction, listLibraryMetersAction, type LibraryMeterOption, deleteLoadProfileSourceAction, parseLoadProfileFileAction, updateLoadProfileSourceAction,
} from '@/actions/load-profile.actions'
import { LOAD_PROFILE_BUCKET, LOAD_PROFILE_MAX_BYTES, LOAD_PROFILE_UPLOAD_RE, loadProfileFilePath } from '@/lib/load-profile/access'
import type { ParsedPart } from '@/lib/load-profile/pipeline'
import type { LoadProfileView, LoadRole, SourceView } from '@/lib/load-profile/view-types'
import { formatNumber } from '@/components/charts/scale'
import type { ArchetypeOption } from './LoadProfileClient'

async function sha256OfBlob(b: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await b.arrayBuffer())
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('')
}

/** From the extension, never the browser's guess (Windows reports CSV as application/csv or text/x-csv, which the bucket refuses). */
function contentTypeOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : ext === 'csv' ? 'text/csv' : 'text/plain'
}

interface PendingFile { path: string; fileName: string; parts: ParsedPart[] }
type Pick = { checked: boolean; label: string; withKva: boolean; role: LoadRole }

const ROLE_LABEL: Record<LoadRole, string> = {
  bulk: 'Bulk supply', tenant: 'Tenant', addition: 'Addition (new load)', check: 'Check meter (not added)', submain: 'Sub-supply / DB (not added)', solar: 'Solar (not added)', generator: 'Generator (not added)',
}
const ROLES = Object.keys(ROLE_LABEL) as LoadRole[]

const KIND_LABEL: Record<SourceView['kind'], string> = { meter: 'Meter file', tenant_schedule: 'Tenant schedule', admd: 'ADMD block', library_meter: 'Solar library meter' }

function QualityLine({ s }: { s: SourceView }) {
  if (s.kind !== 'meter') return <span>{s.detail}</span>
  const q = s.quality
  const parts = [
    `${s.format ?? ''} · ${s.column} · ${s.intervalMin} min`,
    s.conversion,
    q ? `coverage ${q.coveragePct.toFixed(1)} % (${q.first} to ${q.last})` : null,
    q && q.gapRuns ? `${q.gapRuns} gap${q.gapRuns === 1 ? '' : 's'}, longest ${formatNumber(q.longestGapMin / 60, 1)} h` : null,
    q && q.spikes ? `${q.spikes} spike${q.spikes === 1 ? '' : 's'}` : null,
    q && q.negatives ? `${q.negatives} negative` : null,
    q && q.exactDuplicates + q.conflictingDuplicates ? `${q.exactDuplicates + q.conflictingDuplicates} duplicate rows` : null,
    s.filled && s.filled.ownShape ? `${formatNumber(s.filled.ownShape)} h of the year estimated from this meter's own average day` : null,
  ].filter(Boolean)
  return <span>{parts.join(' · ')}</span>
}

export function SourcesPanel({ view, archetypes }: { view: LoadProfileView; archetypes: ArchetypeOption[] }) {
  const router = useRouter()
  const inputId = useId()
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [pending, setPending] = useState<PendingFile[]>([])
  const [picks, setPicks] = useState<Record<string, Pick>>({})
  const [form, setForm] = useState<'none' | 'tenant' | 'admd' | 'library'>('none')
  const [library, setLibrary] = useState<LibraryMeterOption[] | null>(null)
  const [libraryQ, setLibraryQ] = useState('')
  const [libraryPick, setLibraryPick] = useState<Set<string>>(new Set())

  async function openLibrary(q = '') {
    setForm('library')
    setError(null)
    try {
      const r = await listLibraryMetersAction(view.projectId, q)
      if ('error' in r) setError(r.error)
      else { setLibrary(r.meters); setLibraryPick(new Set(r.meters.filter((m) => m.inThisProject).map((m) => m.id))) }
    } catch {
      setError('The library could not be listed. Try again.')
    }
  }
  const [commonArea, setCommonArea] = useState('10')
  const [admd, setAdmd] = useState({ label: 'Residential units', units: '50', admdKva: '2', archetype: 'anchor_24h' })
  const [error, setError] = useState<string | null>(null)
  const key = (f: PendingFile, sheet: string | null, column: string) => `${f.path}|${sheet ?? ''}|${column}`

  async function upload(files: File[]) {
    if (files.length === 0) return
    setBusy(true)
    setError(null)
    const out: string[] = []
    const ready: PendingFile[] = []
    const nextPicks: Record<string, Pick> = {}
    try {
    for (const f of files) {
      if (!LOAD_PROFILE_UPLOAD_RE.test(f.name)) { out.push(`${f.name}: only .csv, .txt or .xlsx meter exports can be imported (save an .xls as .xlsx or CSV).`); continue }
      if (f.size > LOAD_PROFILE_MAX_BYTES) { out.push(`${f.name}: larger than 50 MB.`); continue }
      out.push(`${f.name}: uploading…`)
      setLines([...out])
      const path = loadProfileFilePath(view.projectId, await sha256OfBlob(f), f.name) as string
      const { error: upErr } = await createClient().storage.from(LOAD_PROFILE_BUCKET).upload(path, f, { upsert: false, contentType: contentTypeOf(f.name) })
      if (upErr && !/exist|duplicate/i.test(upErr.message)) { out[out.length - 1] = `${f.name}: the upload failed — try again.`; continue }
      out[out.length - 1] = `${f.name}: reading…`
      setLines([...out])
      const parsed = await parseLoadProfileFileAction(view.projectId, path, f.name)
      if ('error' in parsed || !parsed.ok) { out[out.length - 1] = `${f.name}: ${'error' in parsed ? parsed.error : 'could not be read'}`; continue }
      const pf: PendingFile = { path, fileName: f.name, parts: parsed.parts }
      for (const part of parsed.parts) {
        if (part.plan.status !== 'ok') continue
        for (const c of part.plan.candidates) if (c.role === 'kw' && c.eligible) {
          nextPicks[key(pf, part.sheet, c.column)] = { checked: c.defaultSelected, label: `${f.name.replace(/\.[^.]+$/, '')}${part.sheet ? ` · ${part.sheet}` : ''}${c.defaultSelected ? '' : ` · ${c.column}`}`, withKva: Boolean(c.kvaColumn), role: part.plan.suggestedRole }
        }
      }
      ready.push(pf)
      out[out.length - 1] = `${f.name}: read — choose what to import below.`
    }
    } catch {
      out.push('The upload stopped part-way (the connection or the server timed out). Try again with fewer or smaller files.')
    } finally {
      setLines(out)
      setPending(ready)
      setPicks(nextPicks)
      setBusy(false)
    }
  }

  async function commitAll() {
    setBusy(true)
    setError(null)
    const out: string[] = []
    let finished = false
    try {
    for (const f of pending) {
      for (const part of f.parts) {
        if (part.plan.status !== 'ok') continue
        const selections = part.plan.candidates
          .filter((c) => picks[key(f, part.sheet, c.column)]?.checked)
          .map((c) => ({ column: c.column, label: picks[key(f, part.sheet, c.column)].label, withKva: picks[key(f, part.sheet, c.column)].withKva, role: picks[key(f, part.sheet, c.column)].role }))
        if (selections.length === 0) continue
        const r = await commitLoadProfileFileAction(view.projectId, { path: f.path, fileName: f.fileName, sheet: part.sheet, selections })
        out.push('error' in r ? `${f.fileName}: ${r.error}` : `${f.fileName}: ${r.imported} imported${r.replaced ? `, ${r.replaced} replaced` : ''}${r.warnings.length ? ` — ${r.warnings.join(' ')}` : ''}`)
      }
    }
    finished = true
    } catch {
      out.push('The import stopped part-way (the connection or the server timed out). Channels listed above were saved; press Import selected again for the rest.')
    } finally {
      setLines(out)
      if (finished) setPending([]) // on a failure the choices stay, so a retry needs no re-upload
      setBusy(false)
      router.refresh()
    }
  }

  async function run(p: Promise<{ ok: true } | { error: string }>) {
    setBusy(true)
    setError(null)
    try {
      const r = await p
      if ('error' in r) setError(r.error)
      else { setForm('none'); router.refresh() }
    } catch {
      setError('That did not save (the connection or the server timed out). Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Sources</h2>
      {view.sources.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--c-text-mid)', margin: '0 0 8px' }}>No meter data or estimate yet.</p>
      ) : (
        <table className="table" style={{ width: '100%', fontSize: 13 }}>
          <thead><tr><th>Include</th><th>Source</th><th>Kind</th><th>Role</th><th style={{ textAlign: 'right' }}>kWh / year</th><th style={{ textAlign: 'right' }}>Peak kW</th><th>Detail</th>{view.canEdit && <th />}</tr></thead>
          <tbody>
            {view.sources.map((s) => (
              <tr key={s.id} style={{ opacity: s.included ? 1 : 0.55 }}>
                <td>
                  <input type="checkbox" aria-label={`Include ${s.label}`} checked={s.included} disabled={!view.canEdit || busy}
                    onChange={(e) => void run(updateLoadProfileSourceAction(view.projectId, s.id, { included: e.target.checked }))} />
                </td>
                <td>{s.label}{s.fileName && <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>{s.fileName}</div>}</td>
                <td>{KIND_LABEL[s.kind]}</td>
                <td>
                  {view.canEdit ? (
                    <select aria-label={`Role of ${s.label}`} value={s.role} disabled={busy} onChange={(e) => void run(updateLoadProfileSourceAction(view.projectId, s.id, { role: e.target.value as LoadRole }))}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : ROLE_LABEL[s.role]}
                  {s.included && s.status === 'ok' && !s.counted && <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>not added</div>}
                </td>
                <td style={{ textAlign: 'right' }}>{s.annualKwh == null ? '—' : formatNumber(s.annualKwh)}</td>
                <td style={{ textAlign: 'right' }}>{s.peakKw == null ? '—' : formatNumber(s.peakKw, 1)}</td>
                <td style={{ fontSize: 12 }}>{s.status === 'error' ? <span style={{ color: 'var(--c-red)' }}>{s.error}</span> : <QualityLine s={s} />}</td>
                {view.canEdit && (
                  <td><button className="btn btn-sm" disabled={busy} onClick={() => void run(deleteLoadProfileSourceAction(view.projectId, s.id))}>Remove</button></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {view.compositionNote && <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: '6px 0 0' }}>{view.compositionNote}</p>}
      {view.canEdit && (
        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void upload(Array.from(e.dataTransfer.files)) }}
            style={{ border: '1px dashed var(--c-border)', borderRadius: 8, padding: 10 }}
          >
            <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Working…' : 'Upload meter files'}</label>
            <input id={inputId} type="file" multiple accept=".csv,.txt,.xlsx" disabled={busy} aria-label="Upload meter files"
              onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; void upload(fs) }} style={{ marginLeft: 8, fontSize: 12 }} />
            <span style={{ fontSize: 12, color: 'var(--c-text-dim)', marginLeft: 8 }}>or drop files here · PnP SCADA, sep= portal exports, other CSV · ≤ 50 MB</span>
            {lines.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          </div>

          {pending.length > 0 && (
            <div style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 10 }}>
              <h3 style={{ fontSize: 14, margin: '0 0 6px' }}>Choose channels to import</h3>
              {pending.map((f) => f.parts.map((part) => (
                <div key={`${f.path}|${part.sheet}`} style={{ marginBottom: 10, fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>{f.fileName}{part.sheet ? ` · sheet ${part.sheet}` : ''}</div>
                  {part.plan.status !== 'ok' ? (
                    <div style={{ color: 'var(--c-red)', fontSize: 12 }}>{part.plan.message}</div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
                        {part.plan.formatLabel} · {part.summary.dataRows} rows · {part.summary.periodStart?.slice(0, 10)} to {part.summary.periodEnd?.slice(0, 10)}
                      </div>
                      {part.plan.candidates.map((c) => {
                        const k = key(f, part.sheet, c.column)
                        const p = picks[k]
                        return (
                          <div key={c.column} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginTop: 2, color: c.eligible && c.role === 'kw' ? undefined : 'var(--c-text-dim)' }}>
                            <input type="checkbox" aria-label={`Import ${c.column}`} disabled={!p} checked={Boolean(p?.checked)}
                              onChange={(e) => setPicks({ ...picks, [k]: { ...p, checked: e.target.checked } })} />
                            <span style={{ minWidth: 140 }}>{c.column}</span>
                            <span>{c.role === 'kw' && c.eligible ? c.conversion : c.role === 'kva' ? 'apparent power: used for maximum demand with its kW channel' : c.reason}</span>
                            {p && (
                              <>
                                <input aria-label={`Label for ${c.column}`} value={p.label} onChange={(e) => setPicks({ ...picks, [k]: { ...p, label: e.target.value } })} style={{ flex: 1, fontSize: 12 }} />
                                <select aria-label={`Role for ${c.column}`} value={p.role} onChange={(e) => setPicks({ ...picks, [k]: { ...p, role: e.target.value as LoadRole } })} style={{ fontSize: 12 }}>
                                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                                </select>
                                {c.kvaColumn && (
                                  <label><input type="checkbox" checked={p.withKva} onChange={(e) => setPicks({ ...picks, [k]: { ...p, withKva: e.target.checked } })} /> MD from {c.kvaColumn}</label>
                                )}
                              </>
                            )}
                          </div>
                        )
                      })}
                      {part.plan.warnings.length > 0 && <ul style={{ fontSize: 11, color: 'var(--c-text-mid)', margin: '4px 0 0', paddingLeft: 18 }}>{part.plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                    </>
                  )}
                </div>
              )))}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" disabled={busy || !Object.values(picks).some((p) => p.checked)} onClick={() => void commitAll()}>Import selected</button>
                <button className="btn" disabled={busy} onClick={() => setPending([])}>Cancel</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" disabled={busy} onClick={() => void openLibrary()}>Add meters from the Solar library</button>
            <button className="btn" disabled={busy} onClick={() => setForm(form === 'tenant' ? 'none' : 'tenant')}>Estimate from tenant schedule</button>
            <button className="btn" disabled={busy} onClick={() => setForm(form === 'admd' ? 'none' : 'admd')}>Add an ADMD block</button>
          </div>

          {form === 'library' && (
            <div style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 10, fontSize: 13 }}>
              <p style={{ margin: '0 0 6px' }}>Meters loaded into your organisation&apos;s Solar meter library. Meters imported for this project are ticked; search to add others. Each meter&apos;s role comes from its type and can be changed afterwards.</p>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input aria-label="Search the library" placeholder="Search by meter or site" value={libraryQ} onChange={(e) => setLibraryQ(e.target.value)} style={{ flex: 1 }} />
                <button className="btn btn-sm" disabled={busy} onClick={() => void openLibrary(libraryQ)}>Search</button>
              </div>
              {library === null ? <p>Loading…</p> : library.length === 0 ? <p>No library meters for this project. Search for a site, or upload meter files above.</p> : (
                <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--c-border)', borderRadius: 6 }}>
                  {library.map((m) => (
                    <label key={m.id} style={{ display: 'flex', gap: 8, padding: '3px 6px', fontSize: 12 }}>
                      <input type="checkbox" checked={libraryPick.has(m.id)} onChange={(e) => { const n = new Set(libraryPick); if (e.target.checked) n.add(m.id); else n.delete(m.id); setLibraryPick(n) }} />
                      <span style={{ minWidth: 160 }}>{m.siteLabel ?? '—'}</span><span style={{ flex: 1 }}>{m.label}{m.shopNo ? ` · shop ${m.shopNo}` : ''}</span><span>{m.kind}</span>
                    </label>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button className="btn btn-primary" disabled={busy || libraryPick.size === 0} onClick={() => void run(addLibraryMetersAction(view.projectId, [...libraryPick]).then((r) => ('error' in r ? r : { ok: true as const })))}>Add {libraryPick.size} meter{libraryPick.size === 1 ? '' : 's'}</button>
                <button className="btn" disabled={busy} onClick={() => setForm('none')}>Cancel</button>
              </div>
            </div>
          )}

          {form === 'tenant' && (
            <div style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 10, fontSize: 13 }}>
              <p style={{ margin: '0 0 6px' }}>
                {view.tenants.withArea} of {view.tenants.count} tenants have a shop area ({formatNumber(view.tenants.totalAreaM2)} m²). Each becomes area × the category&apos;s W/m² × an archetype shape (the Solar model).
              </p>
              <label>Common area + <input aria-label="Common area percent" type="number" min={0} max={100} value={commonArea} onChange={(e) => setCommonArea(e.target.value)} style={{ width: 60 }} /> %</label>
              <button className="btn btn-primary" style={{ marginLeft: 8 }} disabled={busy || view.tenants.withArea === 0}
                onClick={() => void run(addSyntheticSourceAction(view.projectId, { kind: 'tenant_schedule', label: 'Tenant schedule estimate', params: { commonAreaPct: Number(commonArea) } }))}>Add estimate</button>
            </div>
          )}

          {form === 'admd' && (
            <div style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 10, fontSize: 13, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input aria-label="Block label" value={admd.label} onChange={(e) => setAdmd({ ...admd, label: e.target.value })} />
              <label><input aria-label="Units" type="number" min={1} value={admd.units} onChange={(e) => setAdmd({ ...admd, units: e.target.value })} style={{ width: 70 }} /> units ×</label>
              <label><input aria-label="ADMD kVA" type="number" min={0.1} step={0.1} value={admd.admdKva} onChange={(e) => setAdmd({ ...admd, admdKva: e.target.value })} style={{ width: 70 }} /> kVA ADMD</label>
              <select aria-label="Shape" value={admd.archetype} onChange={(e) => setAdmd({ ...admd, archetype: e.target.value })}>
                {archetypes.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
              </select>
              <button className="btn btn-primary" disabled={busy}
                onClick={() => void run(addSyntheticSourceAction(view.projectId, { kind: 'admd', label: admd.label, params: { units: Number(admd.units), admdKva: Number(admd.admdKva), archetype: admd.archetype as 'retail' } }))}>Add block</button>
              <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>The block peaks at units × ADMD × power factor.</span>
            </div>
          )}
          {error && <p role="alert" style={{ color: 'var(--c-red)', fontSize: 13, margin: 0 }}>{error}</p>}
        </div>
      )}
    </div>
  )
}
