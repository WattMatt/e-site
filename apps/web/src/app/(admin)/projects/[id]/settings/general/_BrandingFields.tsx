'use client'

import { useRef, useState, useTransition } from 'react'

import { uploadProjectLogoAction } from '@/actions/branding.actions'
import { updateProjectAccentAction } from '@/actions/branding.actions'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'

// ─── compressImage (inlined from useFieldPhotos to avoid a client-bundle
//     import of the full hook into a settings page) ─────────────────────────

const MAX_WIDTH = 2048
const QUALITY = 0.85

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (typeof createImageBitmap !== 'function') return file

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_WIDTH / bitmap.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
    })
  } catch {
    return file
  } finally {
    bitmap?.close()
  }
}

// ─── LogoUploadTile ───────────────────────────────────────────────────────────

interface LogoUploadTileProps {
  label: string
  hint: string
  currentPath: string | null | undefined
  onUpload: (file: File) => Promise<void>
  uploading: boolean
}

function LogoUploadTile({
  label,
  hint,
  currentPath,
  onUpload,
  uploading,
}: LogoUploadTileProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const prepared = await compressImage(file)
      await onUpload(prepared)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      // Reset so the same file can be re-uploaded if needed.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const hasCurrent = Boolean(currentPath)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-mid)' }}>
        {label}
      </span>
      <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>{hint}</span>

      <div
        role="button"
        tabIndex={uploading ? -1 : 0}
        aria-label={`Upload ${label}`}
        aria-disabled={uploading}
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!uploading && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 6,
          height: 72,
          border: '1px dashed var(--c-border)',
          borderRadius: 6,
          cursor: uploading ? 'not-allowed' : 'pointer',
          background: 'var(--c-bg)',
          opacity: uploading ? 0.6 : 1,
          transition: 'border-color 0.15s',
          fontSize: 12,
          color: 'var(--c-text-dim)',
        }}
      >
        {uploading ? (
          'Uploading…'
        ) : hasCurrent ? (
          <>
            <span style={{ color: 'var(--c-green)', fontSize: 11 }}>✓ Logo set</span>
            <span>Click to replace</span>
          </>
        ) : (
          <>
            <span>Click to upload</span>
            <span style={{ fontSize: 11 }}>PNG, JPG, SVG — max 5 MB</span>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
        style={{ display: 'none' }}
        onChange={handleChange}
        disabled={uploading}
      />

      {error && (
        <span role="alert" style={{ fontSize: 11, color: 'var(--c-red)' }}>
          {error}
        </span>
      )}
    </div>
  )
}

// ─── BrandingFields ───────────────────────────────────────────────────────────

export interface BrandingFieldsProps {
  projectId: string
  /** Current storage path for the client logo (slot ②), if any. */
  clientLogoUrl: string | null | undefined
  /** Current storage path for the project mark (slot ③), if any. */
  projectMarkUrl: string | null | undefined
  /** Current accent hex, if any (e.g. "#E69500"). */
  reportAccentColor: string | null | undefined
  /** Org name displayed as read-only issuer label (slot ①). */
  orgName: string
}

export function BrandingFields({
  projectId,
  clientLogoUrl,
  projectMarkUrl,
  reportAccentColor,
  orgName,
}: BrandingFieldsProps) {
  const [clientLogoPath, setClientLogoPath] = useState(clientLogoUrl)
  const [projectMarkPath, setProjectMarkPath] = useState(projectMarkUrl)
  const [accent, setAccent] = useState(reportAccentColor ?? '#E69500')
  const [accentError, setAccentError] = useState<string | null>(null)
  const [accentSaved, setAccentSaved] = useState(false)

  const [isPendingClient, startClientTransition] = useTransition()
  const [isPendingProject, startProjectTransition] = useTransition()
  const [isPendingAccent, startAccentTransition] = useTransition()

  async function handleLogoUpload(slot: 'client' | 'project', file: File) {
    const fd = new FormData()
    fd.append('file', file)
    const result = await uploadProjectLogoAction(projectId, slot, fd)
    if ('error' in result) throw new Error(result.error)
    if (slot === 'client') setClientLogoPath(result.path)
    else setProjectMarkPath(result.path)
  }

  async function handleAccentChange(hex: string) {
    setAccent(hex)
    setAccentError(null)
    setAccentSaved(false)

    startAccentTransition(async () => {
      const result = await updateProjectAccentAction(projectId, hex)
      if ('error' in result) {
        setAccentError(result.error)
      } else {
        setAccentSaved(true)
        // Auto-clear the saved indicator after 2 s.
        setTimeout(() => setAccentSaved(false), 2000)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
          Branding
        </span>
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
          Logos and accent colour used on exported reports
        </span>
      </CardHeader>
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* ① Issuer (org) — read-only note */}
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--c-bg)',
              border: '1px solid var(--c-border)',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--c-text-dim)',
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--c-text-mid)' }}>① Issuer (org):</span>{' '}
            {orgName} — set via Organisation Settings
          </div>

          {/* ② Client logo + ③ Project mark — side by side on wide screens */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 14,
            }}
          >
            <LogoUploadTile
              label="② Client logo"
              hint="Appears as 'Prepared for' on the report cover"
              currentPath={clientLogoPath}
              uploading={isPendingClient}
              onUpload={(file) =>
                new Promise<void>((resolve, reject) =>
                  startClientTransition(() =>
                    handleLogoUpload('client', file).then(resolve).catch(reject),
                  ),
                )
              }
            />
            <LogoUploadTile
              label="③ Project mark"
              hint="Project-specific logo or site mark"
              currentPath={projectMarkPath}
              uploading={isPendingProject}
              onUpload={(file) =>
                new Promise<void>((resolve, reject) =>
                  startProjectTransition(() =>
                    handleLogoUpload('project', file).then(resolve).catch(reject),
                  ),
                )
              }
            />
          </div>

          {/* Accent colour */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-mid)' }}>
              Accent colour
            </span>
            <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
              Highlight colour used on the cover rule and headings. Falls back to the org colour.
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color"
                value={accent.startsWith('#') && accent.length === 7 ? accent : '#E69500'}
                onChange={(e) => handleAccentChange(e.target.value)}
                disabled={isPendingAccent}
                style={{
                  width: 40,
                  height: 32,
                  padding: 2,
                  border: '1px solid var(--c-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: 'none',
                }}
                aria-label="Accent colour picker"
              />
              <input
                type="text"
                value={accent}
                onChange={(e) => handleAccentChange(e.target.value)}
                maxLength={7}
                placeholder="#E69500"
                disabled={isPendingAccent}
                style={{
                  width: 90,
                  padding: '6px 8px',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  border: '1px solid var(--c-border)',
                  borderRadius: 4,
                  background: 'var(--c-bg)',
                  color: 'var(--c-text)',
                }}
                aria-label="Accent colour hex"
              />
              {isPendingAccent && (
                <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>Saving…</span>
              )}
              {accentSaved && !isPendingAccent && (
                <span style={{ fontSize: 11, color: 'var(--c-green)' }}>Saved</span>
              )}
            </div>
            {accentError && (
              <span role="alert" style={{ fontSize: 11, color: 'var(--c-red)' }}>
                {accentError}
              </span>
            )}
          </div>

          {/* ④ Contractor — read-only note */}
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--c-bg)',
              border: '1px solid var(--c-border)',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--c-text-dim)',
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--c-text-mid)' }}>④ Contractor:</span>{' '}
            Resolved per-report when a contractor is assigned
          </div>

          {/* Preview button */}
          <div>
            <button
              type="button"
              onClick={() =>
                window.open(`/api/projects/${projectId}/branding-preview`, '_blank')
              }
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                background: 'var(--c-amber)',
                color: '#000',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Preview branding
            </button>
            <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--c-text-dim)' }}>
              Opens a branded PDF cover in a new tab
            </span>
          </div>

        </div>
      </CardBody>
    </Card>
  )
}
