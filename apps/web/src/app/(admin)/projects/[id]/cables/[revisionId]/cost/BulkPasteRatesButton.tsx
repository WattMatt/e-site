'use client'

/**
 * C10 — Bulk paste rates modal.
 *
 * Engineer pastes tab-separated or CSV rows of:
 *   size_mm2, conductor, supply_rate_per_m, install_rate_per_m, termination_rate_each
 *
 * Header row auto-detected: if the first non-empty cell of row 1 parses as
 * a positive number, the row is treated as data. Otherwise row 1 is dropped
 * as a header.
 *
 * Parse errors are listed inline per row; valid rows preview in a table.
 * Engineer confirms → bulkPasteCostLinesAction → page refresh.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { bulkPasteCostLinesAction } from '@/actions/cable-cost.actions'

interface Props {
  revisionId: string
  disabled?: boolean
}

interface ParsedRow {
  size_mm2: number
  conductor: 'CU' | 'AL'
  supply_rate_per_m: number
  install_rate_per_m: number
  termination_rate_each: number
}

interface ParseError {
  lineNum: number     // 1-based line number in the original paste
  raw: string
  message: string
}

interface ParseResult {
  rows: ParsedRow[]
  errors: ParseError[]
  headerSkipped: boolean
}

const SPLIT_RE = /\t|,/   // tab OR comma (we never mix in the same row)

function looksLikeHeader(cells: string[]): boolean {
  // First cell of a data row must parse as a positive number (size_mm2).
  // If not, treat row as a header and skip.
  const first = (cells[0] ?? '').trim()
  if (first === '') return true
  const n = Number(first)
  return !Number.isFinite(n) || n <= 0
}

function parseConductor(raw: string): 'CU' | 'AL' | null {
  const s = raw.trim().toUpperCase()
  if (s === 'CU' || s === 'COPPER') return 'CU'
  if (s === 'AL' || s === 'ALUMINIUM' || s === 'ALUMINUM') return 'AL'
  return null
}

function parsePaste(text: string): ParseResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) return { rows: [], errors: [], headerSkipped: false }

  const firstCells = lines[0].split(SPLIT_RE).map((c) => c.trim())
  const headerSkipped = looksLikeHeader(firstCells)
  const startIdx = headerSkipped ? 1 : 0

  const rows: ParsedRow[] = []
  const errors: ParseError[] = []

  for (let i = startIdx; i < lines.length; i++) {
    const lineNum = i + 1  // 1-based for the user
    const raw = lines[i]
    const cells = raw.split(SPLIT_RE).map((c) => c.trim())

    if (cells.length < 5) {
      errors.push({ lineNum, raw, message: `Expected 5 columns, got ${cells.length}` })
      continue
    }

    const size = Number(cells[0])
    if (!Number.isFinite(size) || size <= 0) {
      errors.push({ lineNum, raw, message: `Invalid size "${cells[0]}" (must be a positive number)` })
      continue
    }

    const conductor = parseConductor(cells[1])
    if (conductor == null) {
      errors.push({ lineNum, raw, message: `Invalid conductor "${cells[1]}" (must be CU or AL)` })
      continue
    }

    const supply = Number(cells[2])
    const install = Number(cells[3])
    const term = Number(cells[4])
    if (!Number.isFinite(supply) || supply < 0) {
      errors.push({ lineNum, raw, message: `Invalid supply rate "${cells[2]}"` })
      continue
    }
    if (!Number.isFinite(install) || install < 0) {
      errors.push({ lineNum, raw, message: `Invalid install rate "${cells[3]}"` })
      continue
    }
    if (!Number.isFinite(term) || term < 0) {
      errors.push({ lineNum, raw, message: `Invalid termination rate "${cells[4]}"` })
      continue
    }

    rows.push({
      size_mm2: size,
      conductor,
      supply_rate_per_m: supply,
      install_rate_per_m: install,
      termination_rate_each: term,
    })
  }

  return { rows, errors, headerSkipped }
}

export function BulkPasteRatesButton({ revisionId, disabled }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [submitting, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const parsed = parsePaste(text)

  function close() {
    setOpen(false)
    setText('')
    setServerError(null)
  }

  function submit() {
    if (parsed.rows.length === 0) return
    setServerError(null)
    setSuccessMsg(null)
    startTransition(async () => {
      const res = await bulkPasteCostLinesAction({
        revisionId,
        entries: parsed.rows,
      })
      if ('error' in res && !res.ok) {
        setServerError(res.error)
        return
      }
      setSuccessMsg(`✓ Upserted ${res.upserted} rate${res.upserted !== 1 ? 's' : ''}`)
      router.refresh()
      // Auto-close after a short delay so the user sees confirmation.
      setTimeout(() => { close() }, 1200)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title="Paste tab-separated or CSV rates (size, conductor, supply, install, termination)"
        style={{
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          color: 'var(--c-text-mid)',
          borderRadius: 4,
          padding: '6px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.04em',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        📋 Bulk paste rates
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Bulk paste rates"
          onClick={(e) => { if (e.target === e.currentTarget) close() }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 24,
          }}
        >
          <div
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              borderRadius: 6,
              maxWidth: 880, width: '100%', maxHeight: '90vh',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{
              padding: '14px 18px', borderBottom: '1px solid var(--c-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <h2 style={{ margin: 0, fontSize: 14, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
                📋 BULK PASTE RATES
              </h2>
              <button type="button" onClick={close} aria-label="Close" style={{
                background: 'none', border: 'none', color: 'var(--c-text-dim)',
                fontSize: 18, cursor: 'pointer', padding: 4,
              }}>×</button>
            </div>

            <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
              <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: '0 0 10px 0' }}>
                Paste tab-separated (Excel copy) or CSV. Columns in order:
                <br />
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text)' }}>
                  size_mm2, conductor (CU|AL), supply R/m, install R/m, termination R/each
                </code>
                <br />
                <span style={{ color: 'var(--c-text-dim)' }}>
                  Header row optional — auto-detected.
                </span>
              </p>

              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`Size\tCond\tSupply\tInstall\tTerm\n240\tCU\t850\t220\t180\n240\tAL\t260\t220\t180\n120\tCU\t420\t140\t120`}
                rows={10}
                spellCheck={false}
                style={{
                  width: '100%',
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                  background: 'var(--c-base)', color: 'var(--c-text)',
                  border: '1px solid var(--c-border)', borderRadius: 4,
                  padding: 10, resize: 'vertical', minHeight: 140,
                }}
              />

              {text.trim().length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{
                    display: 'flex', gap: 16, fontSize: 11, fontFamily: 'var(--font-mono)',
                    color: 'var(--c-text-mid)', marginBottom: 8,
                  }}>
                    <span>✓ {parsed.rows.length} valid</span>
                    {parsed.errors.length > 0 && (
                      <span style={{ color: '#dc2626' }}>✗ {parsed.errors.length} error{parsed.errors.length !== 1 ? 's' : ''}</span>
                    )}
                    {parsed.headerSkipped && (
                      <span style={{ color: 'var(--c-text-dim)' }}>(header row skipped)</span>
                    )}
                  </div>

                  {parsed.rows.length > 0 && (
                    <div style={{
                      maxHeight: 220, overflowY: 'auto',
                      border: '1px solid var(--c-border)', borderRadius: 4, marginBottom: 10,
                    }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead style={{ position: 'sticky', top: 0, background: 'var(--c-base)' }}>
                          <tr>
                            <th style={pthStyle}>Size</th>
                            <th style={pthStyle}>Cond</th>
                            <th style={pthStyle}>Supply</th>
                            <th style={pthStyle}>Install</th>
                            <th style={pthStyle}>Term</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsed.rows.map((r, i) => (
                            <tr key={i} style={{ borderTop: '1px solid var(--c-border)' }}>
                              <td style={ptdStyle}>{r.size_mm2}</td>
                              <td style={{ ...ptdStyle, color: r.conductor === 'AL' ? 'var(--c-amber)' : 'var(--c-text)' }}>
                                {r.conductor}
                              </td>
                              <td style={ptdStyle}>{r.supply_rate_per_m.toFixed(2)}</td>
                              <td style={ptdStyle}>{r.install_rate_per_m.toFixed(2)}</td>
                              <td style={ptdStyle}>{r.termination_rate_each.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {parsed.errors.length > 0 && (
                    <div style={{
                      background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)',
                      borderRadius: 4, padding: 10, marginBottom: 10, maxHeight: 160, overflowY: 'auto',
                    }}>
                      <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, marginBottom: 6 }}>
                        Parse errors ({parsed.errors.length}):
                      </div>
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {parsed.errors.map((e, i) => (
                          <li key={i} style={{ color: '#dc2626', marginBottom: 4 }}>
                            Line {e.lineNum}: {e.message}
                            <div style={{ color: 'var(--c-text-dim)', marginLeft: 8 }}>“{e.raw}”</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {serverError && (
                <div role="alert" style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>
                  {serverError}
                </div>
              )}
              {successMsg && (
                <div role="status" style={{ color: '#3DB882', fontSize: 12, marginTop: 8 }}>
                  {successMsg}
                </div>
              )}
            </div>

            <div style={{
              padding: '12px 18px', borderTop: '1px solid var(--c-border)',
              display: 'flex', justifyContent: 'flex-end', gap: 10,
            }}>
              <button type="button" onClick={close} style={{
                background: 'transparent', border: '1px solid var(--c-border)',
                color: 'var(--c-text-mid)', borderRadius: 4, padding: '6px 14px',
                fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
              }}>Cancel</button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || parsed.rows.length === 0}
                className="btn-primary-amber"
                style={{
                  padding: '6px 16px', fontFamily: 'var(--font-mono)', fontSize: 11,
                  cursor: (submitting || parsed.rows.length === 0) ? 'not-allowed' : 'pointer',
                  opacity: (submitting || parsed.rows.length === 0) ? 0.5 : 1,
                }}
              >
                {submitting ? 'Saving…' : `Upsert ${parsed.rows.length} rate${parsed.rows.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const pthStyle: React.CSSProperties = {
  textAlign: 'left', padding: '6px 10px',
  fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--c-text-dim)', fontWeight: 600,
}
const ptdStyle: React.CSSProperties = {
  padding: '4px 10px', fontFamily: 'var(--font-mono)', fontSize: 12,
}
