'use client'

import { useRef, useState } from 'react'

interface PhotoPickerProps {
  onFilesSelected: (files: File[]) => void
  accept?: string
  multiple?: boolean
  maxSizeMB?: number
  label?: string
  disabled?: boolean
}

/**
 * Web PhotoPicker — drag-and-drop + click to select images/files.
 * Validates file size client-side before passing to parent.
 */
export function PhotoPicker({
  onFilesSelected,
  accept = 'image/*',
  multiple = true,
  maxSizeMB = 10,
  label = 'Upload photos',
  disabled = false,
}: PhotoPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function processFiles(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    const valid: File[] = []
    const maxBytes = maxSizeMB * 1024 * 1024
    for (const file of Array.from(files)) {
      if (file.size > maxBytes) {
        setError(`${file.name} exceeds ${maxSizeMB}MB limit`)
        continue
      }
      valid.push(file)
    }
    if (valid.length > 0) onFilesSelected(valid)
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${label}. Click or drag and drop files.`}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); inputRef.current?.click() } }}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault()
          setDragging(false)
          if (!disabled) processFiles(e.dataTransfer.files)
        }}
        style={{
          border: `2px dashed ${
            disabled
              ? 'var(--c-border)'
              : dragging
                ? 'var(--c-amber)'
                : 'var(--c-border-mid)'
          }`,
          background: disabled
            ? 'transparent'
            : dragging
              ? 'var(--c-amber-dim)'
              : 'var(--c-panel)',
          borderRadius: 10,
          padding: 24,
          textAlign: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>📷</div>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>{label}</p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 4, letterSpacing: '0.04em' }}>
          Click or drag & drop · Max {maxSizeMB}MB per file
        </p>
      </div>
      {error && (
        <p style={{ color: '#fca5a5', fontSize: 11, marginTop: 6, fontFamily: 'var(--font-mono)' }}>
          {error}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        disabled={disabled}
        onChange={e => processFiles(e.target.files)}
      />
    </div>
  )
}
