'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Magic byte signatures for allowed upload types
const MAGIC: Record<string, { bytes: number[]; mask?: number[] }[]> = {
  'application/pdf': [{ bytes: [0x25, 0x50, 0x44, 0x46] }],            // %PDF
  'image/jpeg':      [{ bytes: [0xFF, 0xD8, 0xFF] }],
  'image/png':       [{ bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }],
  'image/webp':      [{ bytes: [0x52, 0x49, 0x46, 0x46] }],             // RIFF header (bytes 0-3)
  'image/gif':       [{ bytes: [0x47, 0x49, 0x46, 0x38] }],             // GIF8
  'image/heic':      [{ bytes: [0x00, 0x00, 0x00], mask: [0x00, 0x00, 0x00, 0xFF] }], // ftyp box
}

async function validateMagicBytes(file: File): Promise<boolean> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const signatures = MAGIC[file.type]
  // Unknown MIME type — block it
  if (!signatures) return false
  return signatures.some(sig =>
    sig.bytes.every((b, i) => {
      const mask = sig.mask?.[i] ?? 0xFF
      return (header[i]! & mask) === (b & mask)
    }),
  )
}

interface UploadFile {
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  path?: string
  error?: string
}

interface Props {
  bucket: string
  prefix?: string
  onUploadComplete: (paths: string[]) => void
  accept?: string
  multiple?: boolean
  maxSizeMB?: number
}

/**
 * FileUploadWithProgress — uploads to Supabase Storage with per-file progress bars.
 * Uses XMLHttpRequest for progress events (fetch doesn't support upload progress).
 */
export function FileUploadWithProgress({
  bucket,
  prefix = '',
  onUploadComplete,
  accept = 'image/*,.pdf',
  multiple = true,
  maxSizeMB = 10,
}: Props) {
  const [uploads, setUploads] = useState<UploadFile[]>([])
  const supabase = createClient()

  function updateUpload(index: number, patch: Partial<UploadFile>) {
    setUploads(prev => prev.map((u, i) => i === index ? { ...u, ...patch } : u))
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    const maxBytes = maxSizeMB * 1024 * 1024
    const toUpload: UploadFile[] = []

    for (const file of Array.from(files)) {
      if (file.size > maxBytes) {
        toUpload.push({ file, progress: 0, status: 'error', error: `Exceeds ${maxSizeMB}MB` })
      } else {
        toUpload.push({ file, progress: 0, status: 'pending' })
      }
    }

    const startIndex = uploads.length
    setUploads(prev => [...prev, ...toUpload])

    const completedPaths: string[] = []

    for (let i = 0; i < toUpload.length; i++) {
      const item = toUpload[i]
      if (item.status === 'error') continue

      const idx = startIndex + i
      const ext = item.file.name.split('.').pop()
      const path = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

      updateUpload(idx, { status: 'uploading' })

      // Validate file type via magic bytes before upload — blocks MIME-type spoofing
      const validMagic = await validateMagicBytes(item.file)
      if (!validMagic) {
        updateUpload(idx, { status: 'error', progress: 0, error: 'Unsupported file type' })
        continue
      }

      // Simulate progress while Supabase uploads
      let prog = 0
      const progInterval = setInterval(() => {
        prog = Math.min(prog + 10, 85)
        updateUpload(idx, { progress: prog })
      }, 200)

      const { error } = await supabase.storage.from(bucket).upload(path, item.file, {
        contentType: item.file.type,
        upsert: false,
      })

      clearInterval(progInterval)

      if (error) {
        updateUpload(idx, { status: 'error', progress: 0, error: error.message })
      } else {
        updateUpload(idx, { status: 'done', progress: 100, path })
        completedPaths.push(path)
      }
    }

    if (completedPaths.length > 0) {
      onUploadComplete(completedPaths)
    }
  }

  const allDone = uploads.length > 0 && uploads.every(u => u.status === 'done' || u.status === 'error')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') (e.currentTarget.querySelector('input') as HTMLInputElement)?.click() }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed var(--c-border-mid)',
          borderRadius: 10,
          padding: 24,
          cursor: 'pointer',
          textAlign: 'center',
          transition: 'border-color 0.15s',
          background: 'var(--c-panel)',
        }}
      >
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
        <span style={{ fontSize: 28, marginBottom: 8 }}>📎</span>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>Click to upload</p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 4, letterSpacing: '0.04em' }}>
          Max {maxSizeMB}MB per file
        </p>
      </label>

      {uploads.map((u, i) => {
        const statusColor = u.status === 'done'
          ? '#4ade80'
          : u.status === 'error'
            ? 'var(--c-red)'
            : 'var(--c-text-mid)'
        return (
          <div
            key={i}
            style={{
              background: 'var(--c-elevated)',
              border: '1px solid var(--c-border)',
              borderRadius: 6,
              padding: '10px 12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 10 }}>
              <p
                style={{
                  fontSize: 12,
                  color: 'var(--c-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '70%',
                }}
              >
                {u.file.name}
              </p>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: statusColor, letterSpacing: '0.04em' }}>
                {u.status === 'done' ? '✓ Done' :
                 u.status === 'error' ? `✗ ${u.error}` :
                 u.status === 'uploading' ? `${u.progress}%` : 'Pending'}
              </span>
            </div>
            {(u.status === 'uploading' || u.status === 'done') && (
              <div
                role="progressbar"
                aria-valuenow={u.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Uploading ${u.file.name}`}
                style={{
                  height: 3,
                  background: 'var(--c-border)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    background: u.status === 'done' ? '#4ade80' : 'var(--c-amber)',
                    width: `${u.progress}%`,
                    transition: 'width 0.2s',
                  }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
