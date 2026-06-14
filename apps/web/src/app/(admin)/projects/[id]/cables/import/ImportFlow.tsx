'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TableScrollX } from '@/components/ui/TableScrollX'

interface ImportedCable {
  source_row: number
  tag_input: string | null
  from_label: string
  to_label: string
  voltage_v: number | null
  load_a: number | null
  size_mm2: number | null
  ohm_per_km: number | null
  cable_no: number
  measured_length_m: number | null
  source_vd_pct: number | null
  conductor: 'CU' | 'AL'
  section: 'NORMAL' | 'EMERGENCY' | null
  warnings: string[]
  errors: string[]
}

interface ParseResponse {
  fileName: string
  fileSizeBytes: number
  project: { id: string; name: string }
  preview: {
    schedule_sheet_name: string | null
    schedule_header_row: number | null
    detected_columns: Record<string, string>
    cables: ImportedCable[]
    section_breaks: number
    conductor_headers: number
    placeholders_skipped: number
    duplicate_tags: number
    sheet_summary: Array<{ name: string; role: string; row_count: number }>
  }
  counts: {
    total: number
    green: number
    amber: number
    red: number
    fidelity_ok: number
    fidelity_skipped: number
    fidelity_fail: number
  }
}

export function ImportFlow({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [parsed, setParsed] = useState<ParseResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setParsed(null)
  }

  async function parse() {
    if (!file) return
    setParsing(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('projectId', projectId)
      const r = await fetch('/api/cable-schedule/parse', { method: 'POST', body: fd })
      const json = await r.json()
      if (!r.ok) { setError(json.error ?? 'Parse failed'); return }
      setParsed(json as ParseResponse)
    } catch (e: any) {
      setError(e?.message ?? 'Network error')
    } finally {
      setParsing(false)
    }
  }

  async function commit() {
    if (!parsed) return
    setCommitting(true)
    setError(null)
    try {
      const r = await fetch('/api/cable-schedule/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          fileName: parsed.fileName,
          fileSizeBytes: parsed.fileSizeBytes,
          cables: parsed.preview.cables,
          revisionDescription: `Imported from ${parsed.fileName}`,
        }),
      })
      const json = await r.json()
      if (!r.ok) { setError(json.error ?? 'Commit failed'); return }
      router.push(`/projects/${projectId}/cables/${json.revisionId}`)
    } catch (e: any) {
      setError(e?.message ?? 'Network error')
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Step 1: drop file */}
      <div className="data-panel" style={{ padding: 20 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 10,
        }}>
          Step 1 — Upload
        </div>
        <input
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onFile}
          className="ob-input"
          disabled={parsing}
        />
        {file && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginTop: 6 }}>
            {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
          </div>
        )}
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn-primary-amber"
            onClick={parse}
            disabled={!file || parsing}
          >
            {parsing ? 'Parsing…' : 'Parse workbook'}
          </button>
        </div>
        {error && (
          <div role="alert" style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>{error}</div>
        )}
      </div>

      {/* Step 2: preview */}
      {parsed && (
        <>
          <div className="data-panel" style={{ padding: 20 }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 10,
            }}>
              Step 2 — Validation preview
            </div>

            <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
              <Stat label="Cables ready" value={parsed.counts.green} tone="ok" />
              <Stat label="With warnings" value={parsed.counts.amber} tone="warn" />
              <Stat label="Blocked" value={parsed.counts.red} tone="bad" />
              <Stat label="VD fidelity ✓" value={parsed.counts.fidelity_ok} tone="ok" />
              <Stat label="VD fidelity ✕" value={parsed.counts.fidelity_fail} tone="warn" />
              <Stat label="Section breaks" value={parsed.preview.section_breaks} tone="neutral" />
              <Stat label="Conductor headers" value={parsed.preview.conductor_headers} tone="neutral" />
              <Stat label="Duplicate tags" value={parsed.preview.duplicate_tags} tone={parsed.preview.duplicate_tags > 0 ? 'warn' : 'neutral'} />
            </div>

            <div style={{
              padding: '8px 12px', background: 'var(--c-base)', borderRadius: 4,
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginBottom: 12,
            }}>
              Detected schedule sheet: <strong style={{ color: 'var(--c-text)' }}>{parsed.preview.schedule_sheet_name ?? '—'}</strong> ·
              {' '}header row {parsed.preview.schedule_header_row ?? '—'} ·
              {' '}mapped {Object.keys(parsed.preview.detected_columns).length} columns
            </div>

            <TableScrollX>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                <thead>
                  <tr style={{ background: 'var(--c-base)' }}>
                    <Th align="right" w={50}>Row</Th>
                    <Th w={40} align="center">Status</Th>
                    <Th>From</Th>
                    <Th>To</Th>
                    <Th align="right">mm²</Th>
                    <Th align="right">A</Th>
                    <Th align="right">Length</Th>
                    <Th align="right">Ω/km</Th>
                    <Th align="right">VD %</Th>
                    <Th>Cond</Th>
                    <Th>Notes</Th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.preview.cables.map((c) => {
                    const tone =
                      c.errors.length > 0 ? '#dc2626'
                      : c.warnings.length > 0 ? 'var(--c-amber)'
                      : '#16a34a'
                    return (
                      <tr key={c.source_row} style={{ borderTop: '1px solid var(--c-border)' }}>
                        <Td align="right">{c.source_row}</Td>
                        <Td align="center" style={{ color: tone, fontWeight: 700 }}>●</Td>
                        <Td>{c.from_label}</Td>
                        <Td>{c.to_label}</Td>
                        <Td align="right">{c.size_mm2 ?? '—'}</Td>
                        <Td align="right">{c.load_a ?? '—'}</Td>
                        <Td align="right">{c.measured_length_m == null ? '—' : Number(c.measured_length_m).toFixed(1)}</Td>
                        <Td align="right">{c.ohm_per_km == null ? '—' : Number(c.ohm_per_km).toFixed(4)}</Td>
                        <Td align="right">{c.source_vd_pct == null ? '—' : Number(c.source_vd_pct).toFixed(2)}</Td>
                        <Td>{c.conductor}</Td>
                        <Td style={{ whiteSpace: 'normal', maxWidth: 360 }}>
                          {c.errors.map((e) => (
                            <div key={e} style={{ color: '#dc2626', fontSize: 11 }}>✕ {e}</div>
                          ))}
                          {c.warnings.map((w) => (
                            <div key={w} style={{ color: 'var(--c-amber)', fontSize: 11 }}>⚠ {w}</div>
                          ))}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </TableScrollX>
          </div>

          {/* Step 3: commit */}
          <div className="data-panel" style={{ padding: 20 }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 10,
            }}>
              Step 3 — Commit to new DRAFT revision
            </div>
            <div style={{ fontSize: 13, color: 'var(--c-text-mid)', marginBottom: 10 }}>
              Importing into <strong>{projectName}</strong>. A new Rev N DRAFT will be created
              with every detected source, board, supply and cable. Amber rows commit with
              their warnings attached to the cable's notes.
            </div>
            {parsed.counts.red > 0 ? (
              <div role="alert" style={{
                padding: 10, borderRadius: 6,
                background: 'rgba(220,38,38,0.08)', border: '1px solid #dc2626',
                color: '#dc2626', fontSize: 12,
              }}>
                {parsed.counts.red} row(s) are blocked. Resolve the errors above (or
                upload a fixed workbook) before committing.
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-primary-amber"
                  onClick={commit}
                  disabled={committing}
                >
                  {committing ? 'Committing…' : `Commit ${parsed.counts.total} cables into new revision`}
                </button>
              </div>
            )}
            {error && (
              <div role="alert" style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>{error}</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const color =
    tone === 'ok'   ? '#16a34a'
    : tone === 'warn' ? 'var(--c-amber)'
    : tone === 'bad'  ? '#dc2626'
    : 'var(--c-text-mid)'
  return (
    <div style={{
      padding: '8px 12px',
      background: 'var(--c-base)',
      border: '1px solid var(--c-border)',
      borderRadius: 6,
      minWidth: 120,
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--c-text-dim)',
      }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function Th({ children, align, w }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center'; w?: number }) {
  return (
    <th style={{
      textAlign: align ?? 'left', padding: '8px 10px',
      fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'var(--c-text-dim)', fontWeight: 600, whiteSpace: 'nowrap', width: w,
    }}>{children}</th>
  )
}

function Td({ children, align, style }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center'; style?: React.CSSProperties }) {
  return (
    <td style={{
      textAlign: align ?? 'left', padding: '6px 10px', verticalAlign: 'top',
      color: 'var(--c-text)', whiteSpace: 'nowrap',
      ...style,
    }}>{children}</td>
  )
}
