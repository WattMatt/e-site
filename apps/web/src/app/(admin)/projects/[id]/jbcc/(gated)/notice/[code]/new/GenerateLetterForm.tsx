'use client'

import { useState, useTransition, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { JbccNotice, JbccNoticeField, JbccParty } from '@esite/shared'
import {
  generateLetterAction, previewLetterAction, downloadExampleAction,
} from '@/actions/jbcc.actions'

interface Props {
  projectId: string
  notice:    JbccNotice
  fields:    JbccNoticeField[]
  parties:   JbccParty[]
}

interface Preview { headerHtml: string; bodyHtml: string }

export function GenerateLetterForm({ projectId, notice, fields, parties }: Props) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [error, setError]     = useState<string | null>(null)
  const [notice_msg, setMsg]  = useState<string | null>(null)

  const manualFields  = fields.filter(f => f.source === 'manual')
  const needsTrigger  = notice.time_bar_days !== null
  const hasParties    = parties.length > 0

  const [recipientId,  setRecipientId]  = useState<string>('')
  const [subject,      setSubject]      = useState<string>(notice.title)
  const [triggerDate,  setTriggerDate]  = useState<string>('')
  const [ccIds,        setCcIds]        = useState<Set<string>>(new Set())
  const [manualValues, setManualValues] = useState<Record<string, string>>(
    Object.fromEntries(manualFields.map(f => [f.placeholder, ''])),
  )

  const [preview, setPreview]           = useState<Preview | null>(null)
  const [previewErr, setPreviewErr]     = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(true)
  const reqSeq = useRef(0)

  // Live preview — re-renders (debounced) as the operator edits. Works with NO
  // recipient/fields: an EXAMPLE letter is visible from the onset.
  const refreshPreview = useCallback(() => {
    const seq = ++reqSeq.current
    setPreviewLoading(true)
    setPreviewErr(null)
    ;(async () => {
      const result = await previewLetterAction(projectId, {
        notice_code:        notice.code,
        recipient_party_id: recipientId || null,
        trigger_date:       needsTrigger && triggerDate ? triggerDate : null,
        manual_values:      manualValues,
      })
      if (seq !== reqSeq.current) return // stale
      if (result.ok) setPreview({ headerHtml: result.data.headerHtml, bodyHtml: result.data.bodyHtml })
      else setPreviewErr(result.error)
      setPreviewLoading(false)
    })()
  }, [projectId, notice.code, recipientId, needsTrigger, triggerDate, manualValues])

  useEffect(() => {
    const t = setTimeout(refreshPreview, 550)
    return () => clearTimeout(t)
  }, [refreshPreview])

  function handleManualChange(placeholder: string, value: string) {
    setManualValues(prev => ({ ...prev, [placeholder]: value }))
  }

  function toggleCc(id: string) {
    setCcIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function missingRequired(): string | null {
    if (!recipientId) return 'Choose a recipient party before generating the final letter.'
    if (needsTrigger && !triggerDate) return 'A trigger date is required for this time-barred notice.'
    for (const f of manualFields) {
      if (f.required && !(manualValues[f.placeholder] ?? '').trim()) return `“${f.label}” is required.`
    }
    return null
  }

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setMsg(null)
    const miss = missingRequired()
    if (miss) { setError(miss); return }

    const payload = {
      notice_code:        notice.code,
      recipient_party_id: recipientId,
      trigger_date:       needsTrigger && triggerDate ? triggerDate : null,
      manual_values:      manualValues,
      subject:            subject || notice.title,
      cc_party_ids:       Array.from(ccIds).filter(id => id !== recipientId),
    }

    startTransition(async () => {
      const result = await generateLetterAction(projectId, payload)
      if (!result.ok) { setError(result.error); return }
      const { letterId, documentPath } = result.data
      try {
        const res = await fetch(`/api/jbcc/sign?path=${encodeURIComponent(documentPath)}`)
        if (res.ok) {
          const { url } = await res.json() as { url: string }
          triggerDownload(url, `${result.data.letterReference ?? notice.code}.docx`)
        }
      } catch { /* download is non-fatal; the letter row exists */ }
      router.push(`/projects/${projectId}/jbcc/tracking/${letterId}`)
    })
  }

  function handleDownloadExample() {
    setError(null); setMsg(null)
    startTransition(async () => {
      const result = await downloadExampleAction(projectId, {
        notice_code:        notice.code,
        recipient_party_id: recipientId || null,
        trigger_date:       needsTrigger && triggerDate ? triggerDate : null,
        manual_values:      manualValues,
      })
      if (!result.ok) { setError(result.error); return }
      const blob = base64ToBlob(result.data.base64, DOCX_MIME)
      const url = URL.createObjectURL(blob)
      triggerDownload(url, result.data.filename)
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      setMsg('Example letter downloaded. It is a SPECIMEN — no controlled number is consumed.')
    })
  }

  return (
    <div className="jbcc-page-fade" style={{ padding: '40px clamp(16px,4vw,40px) 96px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Eyebrow */}
      <div style={eyebrow}>
        {notice.code}
        <span style={{ height: 1, flex: 1, background: 'linear-gradient(90deg, var(--c-amber-mid-rgb, rgba(232,146,58,.32)), transparent)', maxWidth: 80 }} />
      </div>
      <h1 style={h1Style}>Generate Letter</h1>
      <p style={{ fontSize: 13, color: 'var(--c-text-muted)', margin: '0 0 28px', maxWidth: 640, lineHeight: 1.6 }}>
        The example on the right updates live. Download a specimen any time. To generate a <strong>controlled, numbered</strong> letter
        you only need to choose a recipient and complete the required fields below.
      </p>

      <div style={grid}>
        {/* ── Form column ── */}
        <form onSubmit={handleGenerate} style={{ display: 'grid', gap: 22, alignContent: 'start' }}>
          {!hasParties && (
            <div style={noteBox}>
              No parties are registered yet. You can still preview and download an example.
              To generate the final letter, <a href={`/projects/${projectId}/jbcc/parties`} style={{ color: 'var(--c-amber)' }}>add a party →</a>
            </div>
          )}

          {/* Recipient */}
          <div>
            <label htmlFor="recipient" className="jbcc-label">
              Recipient party {hasParties && <span style={{ color: 'var(--c-text-muted)' }}>(required to generate)</span>}
            </label>
            <select id="recipient" value={recipientId} onChange={e => setRecipientId(e.target.value)} className="jbcc-input" style={{ appearance: 'none' }} disabled={!hasParties}>
              <option value="">{hasParties ? 'Select a recipient…' : 'No parties yet'}</option>
              {parties.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.company ? ` — ${p.company}` : ''} ({p.party_role.replace(/_/g, ' ')})
                </option>
              ))}
            </select>
          </div>

          {/* Subject */}
          <div>
            <label htmlFor="subject" className="jbcc-label">Subject / title</label>
            <input id="subject" type="text" value={subject} onChange={e => setSubject(e.target.value)} className="jbcc-input" maxLength={240} />
          </div>

          {/* CC parties */}
          {hasParties && parties.length > 1 && (
            <div>
              <label className="jbcc-label">Copy to (CC)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {parties.filter(p => p.id !== recipientId).map(p => (
                  <button type="button" key={p.id} onClick={() => toggleCc(p.id)}
                    className="jbcc-chip"
                    style={{ cursor: 'pointer', border: '1px solid', borderColor: ccIds.has(p.id) ? 'var(--c-amber)' : 'var(--c-border)', background: ccIds.has(p.id) ? 'var(--c-amber-dim-rgb, rgba(232,146,58,.12))' : 'transparent', color: ccIds.has(p.id) ? 'var(--c-amber)' : 'var(--c-text-muted)' }}>
                    {ccIds.has(p.id) ? '✓ ' : ''}{p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Trigger date */}
          {needsTrigger && (
            <div>
              <label htmlFor="trigger_date" className="jbcc-label">
                Trigger date · {notice.time_bar_days} {notice.time_bar_unit === 'WD' ? 'working' : 'calendar'} days
              </label>
              <input id="trigger_date" type="date" value={triggerDate} onChange={e => setTriggerDate(e.target.value)} className="jbcc-input" />
            </div>
          )}

          {/* Manual fields */}
          {manualFields.map(field => {
            const value = manualValues[field.placeholder] ?? ''
            return (
              <div key={field.id}>
                <label htmlFor={`field-${field.id}`} className="jbcc-label">
                  {field.label}{field.required && <span style={{ color: 'var(--c-red-bright)' }}> *</span>}
                </label>
                {field.field_type === 'textarea' ? (
                  <textarea id={`field-${field.id}`} value={value} onChange={e => handleManualChange(field.placeholder, e.target.value)} rows={3} className="jbcc-input" style={{ resize: 'vertical' }} />
                ) : (
                  <input id={`field-${field.id}`} type={field.field_type === 'date' ? 'date' : field.field_type === 'number' ? 'number' : 'text'} value={value} onChange={e => handleManualChange(field.placeholder, e.target.value)} className="jbcc-input" />
                )}
              </div>
            )
          })}

          {error && <div role="alert" style={errBox}>{error}</div>}
          {notice_msg && <div style={okBox}>{notice_msg}</div>}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
            <button type="submit" disabled={busy || !hasParties} className="jbcc-btn-cta"
              style={{ background: busy || !hasParties ? 'transparent' : 'var(--c-amber)', color: busy || !hasParties ? 'var(--c-text-muted)' : 'var(--c-base)', borderColor: busy || !hasParties ? 'var(--c-border)' : 'var(--c-amber)' }}>
              {busy ? 'Working…' : 'Generate & Save →'}
            </button>
            <button type="button" onClick={handleDownloadExample} disabled={busy} className="jbcc-btn-cta"
              style={{ background: 'transparent', color: 'var(--c-text)', borderColor: 'var(--c-border)' }}>
              Download Example
            </button>
          </div>
        </form>

        {/* ── Live preview column ── */}
        <div style={{ position: 'sticky', top: 24, alignSelf: 'start' }}>
          <div style={previewLabel}>
            <span>Live Preview {previewLoading && <span style={{ color: 'var(--c-amber)' }}>· rendering…</span>}</span>
            <span style={{ opacity: .6 }}>{recipientId ? 'with recipient' : 'example'}</span>
          </div>
          <div className="jbcc-letter-paper" style={paper}>
            {previewErr ? (
              <div style={{ color: 'var(--c-red-bright)', fontFamily: 'var(--f-mono-display)', fontSize: 12 }}>{previewErr}</div>
            ) : preview ? (
              <>
                <div dangerouslySetInnerHTML={{ __html: preview.headerHtml }} />
                <div className="jbcc-letter-body" dangerouslySetInnerHTML={{ __html: preview.bodyHtml }} />
              </>
            ) : (
              <div style={{ color: '#999', fontSize: 13 }}>Preparing example…</div>
            )}
          </div>
          <p style={{ fontFamily: 'var(--f-mono-display)', fontSize: 10, letterSpacing: '.06em', color: 'var(--c-text-muted)', marginTop: 10, textAlign: 'center' }}>
            [BRACKETS] MARK FIELDS THAT WILL BE FILLED FROM YOUR PARTIES & INPUTS
          </p>
        </div>
      </div>

      <style>{PREVIEW_CSS}</style>
    </div>
  )
}

// ── helpers ──
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

// ── styles ──
const eyebrow: React.CSSProperties = { fontFamily: 'var(--f-mono-display)', fontSize: 11, fontWeight: 500, letterSpacing: '0.24em', color: 'var(--c-amber)', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }
const h1Style: React.CSSProperties = { fontFamily: 'var(--f-display)', fontStyle: 'italic', fontWeight: 350, fontSize: 'clamp(24px, 3.5vw, 42px)', lineHeight: 1.05, letterSpacing: '-0.02em', color: 'var(--c-text)', fontVariationSettings: "'opsz' 72, 'SOFT' 30", margin: '0 0 12px' }
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.05fr)', gap: 'clamp(20px, 4vw, 48px)', alignItems: 'start' }
const noteBox: React.CSSProperties = { padding: '12px 14px', border: '1px dashed var(--c-border)', borderRadius: 2, fontSize: 12.5, color: 'var(--c-text-muted)', lineHeight: 1.55 }
const errBox: React.CSSProperties = { padding: '12px 16px', background: 'var(--c-red-dim-rgb, rgba(255,107,107,.10))', border: '1px solid var(--c-red)', fontFamily: 'var(--f-mono-display)', fontSize: 12, color: 'var(--c-red-bright)' }
const okBox: React.CSSProperties = { padding: '12px 16px', background: 'var(--c-green-dim-rgb, rgba(107,207,127,.10))', border: '1px solid var(--c-green)', fontFamily: 'var(--f-mono-display)', fontSize: 12, color: 'var(--c-green)' }
const previewLabel: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-mono-display)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--c-text-muted)', marginBottom: 8 }
const paper: React.CSSProperties = { background: '#fff', color: '#1a1a1a', borderRadius: 3, boxShadow: '0 8px 40px rgba(0,0,0,.28)', padding: 'clamp(22px, 3.5vw, 40px)', minHeight: 400, maxHeight: '78vh', overflowY: 'auto', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 13.5, lineHeight: 1.6 }

const PREVIEW_CSS = `
.jbcc-letter-body { margin-top: 14px; }
.jbcc-letter-body p { margin: 0 0 10px; }
.jbcc-letter-body table { border-collapse: collapse; width: 100%; }
.jbcc-letter-body td, .jbcc-letter-body th { border: 1px solid #ddd; padding: 4px 8px; }
.jbcc-letter-body strong { font-weight: 700; }
@media (max-width: 860px) { .jbcc-page-fade > div[style*="grid-template-columns"] { grid-template-columns: 1fr !important; } }
`
