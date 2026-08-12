'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadFormSignature, SITE_FORM_SIGNATURE_BUCKET } from '@/lib/site-forms/upload'
import type { SiteFormSignatureBlock } from '@esite/shared'

/**
 * Drawn signature capture for the four `field.form_signatures` blocks.
 *
 * Self-contained rather than reusing the inspections SignatureModal: that
 * component writes `inspections.signatures` against an `inspection_id`, and
 * parameterising it would mean editing a live production module.
 */

export interface FormSignatureRow {
  id: string
  block_id: string
  signatory_name: string
  signatory_role: string | null
  registration_category: string | null
  registration_number: string | null
  storage_path: string
  signed_at: string | null
  signed_by: string | null
  signed_by_name?: string | null
  signed_url?: string | null
}

/**
 * Template signature field → storage block.
 *
 * The template carries SEVEN signature fields but `field.form_signatures` has
 * `UNIQUE (form_id, block_id)` over exactly FOUR blocks. Only the four §13
 * declaration signatures are bound to a block; the remaining three are aliases
 * of a block signed elsewhere (below). Binding them all would mean the §13
 * declaration silently overwrote the section-6 safe-isolation signature — an
 * overwritten signature on a safety record is worse than a missing one.
 */
export const SIGNATURE_FIELD_BLOCKS: Record<string, SiteFormSignatureBlock> = {
  electrician_declaration_signature: 'electrician',
  registered_person_declaration_signature: 'registered_person',
  supervisor_signature: 'supervisor',
  client_signature: 'client_witness',
}

/**
 * Signature fields that are satisfied by a block captured in §13 Declarations.
 * They render as a live status pointer, not a second pad.
 */
export const SIGNATURE_FIELD_ALIASES: Record<string, SiteFormSignatureBlock> = {
  safe_isolation_confirmed: 'electrician',
  hazard_sweep_technician_signature: 'electrician',
  hazard_sweep_supervisor_signature: 'supervisor',
}

export const SIGNATURE_BLOCK_LABELS: Record<SiteFormSignatureBlock, string> = {
  electrician: 'Electrician',
  registered_person: 'Registered person',
  supervisor: 'Supervisor',
  client_witness: 'Client / witness',
}

/** Resolve the block a signature field writes to, if any. */
export function blockForSignatureField(fieldId: string): SiteFormSignatureBlock | null {
  return SIGNATURE_FIELD_BLOCKS[fieldId] ?? null
}

/** Resolve the block a signature field merely reports on, if any. */
export function aliasBlockForSignatureField(fieldId: string): SiteFormSignatureBlock | null {
  return SIGNATURE_FIELD_ALIASES[fieldId] ?? null
}

/** The registration categories a registered person can hold (EIR reg 1). */
const REGISTRATION_CATEGORIES = [
  'master_installation_electrician',
  'installation_electrician',
  'electrical_tester_single_phase',
] as const

const CATEGORY_LABELS: Record<string, string> = {
  master_installation_electrician: 'Master installation electrician',
  installation_electrician: 'Installation electrician',
  electrical_tester_single_phase: 'Electrical tester for single phase',
}

/** Signature PNGs must fit the bucket's 512 KB cap (migration 00179). */
const MAX_SIGNATURE_BYTES = 512 * 1024

type PgError = { message: string } | null

interface SignatureLookupClient {
  schema(name: string): {
    from(table: string): {
      select(columns: string): {
        eq(
          column: string,
          value: string,
        ): { maybeSingle(): PromiseLike<{ data: { storage_path: string } | null; error: PgError }> }
      }
    }
  }
}

interface Props {
  projectId: string
  formId: string
  blockId: SiteFormSignatureBlock
  label: string
  helpText?: string
  required?: boolean
  readOnly: boolean
  currentUserId: string | null
  /** Category pre-selected from the personnel section, when one was captured. */
  suggestedCategory?: string | null
  existing?: FormSignatureRow
  onSaved: (row: FormSignatureRow) => void
}

export default function SignaturePad({
  projectId,
  formId,
  blockId,
  label,
  helpText,
  required,
  readOnly,
  currentUserId,
  suggestedCategory,
  existing,
  onSaved,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [hasInk, setHasInk] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Two-step inline confirm — window.confirm() is silently suppressed by
  // Safari on this stack, which has cost real debugging time before.
  const [clearArmed, setClearArmed] = useState(false)

  const [name, setName] = useState(existing?.signatory_name ?? '')
  const [role, setRole] = useState(existing?.signatory_role ?? '')
  const [category, setCategory] = useState(
    existing?.registration_category ?? suggestedCategory ?? '',
  )
  const [regNo, setRegNo] = useState(existing?.registration_number ?? '')

  const needsRegistration = blockId === 'registered_person' || blockId === 'electrician'

  /**
   * Size the backing store to the CSS box × DPR so strokes are crisp, keeping
   * any ink already drawn across an orientation change on a tablet.
   */
  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width * dpr))
    const h = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width === w && canvas.height === h) return

    let carried: HTMLCanvasElement | null = null
    if (canvas.width > 0 && canvas.height > 0) {
      carried = document.createElement('canvas')
      carried.width = canvas.width
      carried.height = canvas.height
      carried.getContext('2d')?.drawImage(canvas, 0, 0)
    }

    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // A white ground, not transparency: the PNG is composited onto a white
    // PDF page and onto whatever a mail client uses as its background.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    if (carried) ctx.drawImage(carried, 0, 0, w, h)
    ctx.lineWidth = 2 * dpr
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111111'
  }, [])

  useEffect(() => {
    if (!open) return
    sizeCanvas()
    window.addEventListener('resize', sizeCanvas)
    return () => window.removeEventListener('resize', sizeCanvas)
  }, [open, sizeCanvas])

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  // Pointer events (not touch/mouse) so finger, stylus and mouse all draw
  // through one code path, and pointer capture keeps a stroke alive when the
  // finger slides off the pad.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (readOnly) return
    e.preventDefault()
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const p = pointOf(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    // A single tap is a legitimate dot — mark ink immediately.
    ctx.lineTo(p.x + 0.01, p.y)
    ctx.stroke()
    setHasInk(true)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx) return
    const p = pointOf(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const clearPad = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#111111'
    setHasInk(false)
  }

  const save = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!name.trim()) {
      setError('Enter the name of the person signing.')
      return
    }
    if (!hasInk) {
      setError('Sign in the box above before saving.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      )
      if (!blob) throw new Error('Could not read the signature from the canvas.')
      if (blob.size > MAX_SIGNATURE_BYTES) {
        throw new Error('The signature image is too large. Clear it and sign more simply.')
      }

      const supabase = createClient()
      const result = await uploadFormSignature(
        supabase as unknown as Parameters<typeof uploadFormSignature>[0],
        {
          pngBlob: blob,
          projectId,
          formId,
          blockId,
          signatoryName: name.trim(),
          signatoryRole: role.trim() || null,
          registrationCategory: category.trim() || null,
          registrationNumber: regNo.trim() || null,
          signedBy: currentUserId,
        },
      )
      if ('error' in result) throw new Error(result.error)

      // The helper owns the storage path layout (load-bearing for RLS) and
      // returns only the row id, so the path is read back rather than rebuilt.
      const lookup = supabase as unknown as SignatureLookupClient
      const { data: row } = await lookup
        .schema('field')
        .from('form_signatures')
        .select('storage_path')
        .eq('id', result.id)
        .maybeSingle()

      let signedUrl: string | null = null
      if (row?.storage_path) {
        const { data: sig } = await supabase.storage
          .from(SITE_FORM_SIGNATURE_BUCKET)
          .createSignedUrl(row.storage_path, 3600)
        signedUrl = sig?.signedUrl ?? null
      }

      onSaved({
        id: result.id,
        block_id: blockId,
        signatory_name: name.trim(),
        signatory_role: role.trim() || null,
        registration_category: category.trim() || null,
        registration_number: regNo.trim() || null,
        storage_path: row?.storage_path ?? '',
        signed_at: new Date().toISOString(),
        signed_by: currentUserId,
        signed_url: signedUrl,
      })
      setOpen(false)
      setHasInk(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
          {label}
          {required && <span style={{ color: 'var(--c-red)', marginLeft: 4 }}>*</span>}
        </span>
        {helpText && (
          <p className="form-hint" style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>
            {helpText}
          </p>
        )}
      </div>

      {existing && !open && (
        <div
          style={{
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            padding: 10,
            background: 'var(--c-panel)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {existing.signed_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={existing.signed_url}
              alt={`Signature of ${existing.signatory_name}`}
              style={{
                maxWidth: 320,
                width: '100%',
                height: 'auto',
                background: '#fff',
                borderRadius: 4,
                border: '1px solid var(--c-border)',
              }}
            />
          ) : (
            <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
              Signature recorded (image unavailable).
            </span>
          )}
          <div style={{ fontSize: 12, color: 'var(--c-text)' }}>
            <strong>{existing.signatory_name}</strong>
            {existing.signatory_role ? ` — ${existing.signatory_role}` : ''}
          </div>
          {(existing.registration_category || existing.registration_number) && (
            <div style={{ fontSize: 11, color: 'var(--c-text-mid)' }}>
              {existing.registration_category
                ? (CATEGORY_LABELS[existing.registration_category] ??
                  existing.registration_category)
                : ''}
              {existing.registration_number ? ` · ${existing.registration_number}` : ''}
            </div>
          )}
          {existing.signed_at && (
            <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
              Signed {new Date(existing.signed_at).toLocaleString()}
            </div>
          )}
          {!readOnly && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setOpen(true)
                setHasInk(false)
                setError(null)
              }}
              style={buttonStyle(false)}
            >
              Re-sign
            </button>
          )}
        </div>
      )}

      {!existing && !open && (
        <div
          style={{
            border: '1px dashed var(--c-border)',
            borderRadius: 6,
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Not signed.</span>
          {!readOnly && (
            <button type="button" onClick={() => setOpen(true)} style={buttonStyle(true)}>
              Sign
            </button>
          )}
        </div>
      )}

      {open && !readOnly && (
        <div
          style={{
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            padding: 12,
            background: 'var(--c-panel)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={endStroke}
            style={{
              width: '100%',
              height: 180,
              background: '#ffffff',
              borderRadius: 4,
              border: '1px solid var(--c-border-mid)',
              // Without this the browser claims the gesture for scrolling and
              // no stroke is ever drawn on a touch device.
              touchAction: 'none',
              cursor: 'crosshair',
              display: 'block',
            }}
          />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                if (clearArmed) {
                  clearPad()
                  setClearArmed(false)
                } else {
                  setClearArmed(true)
                  setTimeout(() => setClearArmed(false), 3000)
                }
              }}
              style={buttonStyle(false, clearArmed ? 'var(--c-red)' : undefined)}
            >
              {clearArmed ? 'Tap again to clear' : 'Clear'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
              style={buttonStyle(false)}
            >
              Cancel
            </button>
          </div>

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <label style={fieldLabelStyle}>
              Name of signatory *
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                style={inputStyle}
              />
            </label>
            <label style={fieldLabelStyle}>
              Role / position
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. Site electrician"
                style={inputStyle}
              />
            </label>
            {needsRegistration && (
              <>
                <label style={fieldLabelStyle}>
                  Registration category
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">Not registered / not applicable</option>
                    {REGISTRATION_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={fieldLabelStyle}>
                  Registration number
                  <input
                    type="text"
                    value={regNo}
                    onChange={(e) => setRegNo(e.target.value)}
                    placeholder="e.g. IE 12345"
                    style={inputStyle}
                  />
                </label>
              </>
            )}
          </div>

          {error && (
            <p className="form-error" style={{ fontSize: 12, color: 'var(--c-red)', margin: 0 }}>
              {error}
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={save}
            disabled={saving}
            style={buttonStyle(true)}
          >
            {saving ? 'Saving…' : `Save ${SIGNATURE_BLOCK_LABELS[blockId].toLowerCase()} signature`}
          </button>
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 4,
  padding: '10px 8px',
  borderRadius: 6,
  border: '1px solid var(--c-border)',
  background: 'var(--c-input-bg)',
  color: 'var(--c-text)',
  fontSize: 14,
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--c-text-mid)',
  display: 'block',
}

function buttonStyle(primary: boolean, accent?: string): React.CSSProperties {
  return {
    padding: '10px 14px',
    borderRadius: 6,
    border: `1px solid ${accent ?? (primary ? 'var(--c-amber-mid)' : 'var(--c-border)')}`,
    background: primary ? 'var(--c-amber-dim)' : 'transparent',
    color: accent ?? (primary ? 'var(--c-amber)' : 'var(--c-text-mid)'),
    fontSize: 13,
    fontWeight: primary ? 600 : 400,
    cursor: 'pointer',
  }
}
