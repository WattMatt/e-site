'use client'

import { useRef } from 'react'

interface PhotoSourcePickerProps {
  /** Called with the files picked by either control (never empty). */
  onFiles: (files: File[]) => void
  accept?: string
  disabled?: boolean
  /** Visible label of the library control. */
  chooseLabel?: string
}

/**
 * Two ways to add photos, side by side:
 * - "Take photo" opens the rear camera directly (capture="environment"). On a
 *   phone that returns ONE shot per tap, so callers must add to their list,
 *   never replace it.
 * - "Choose photos" opens the library / file picker with multi-select, for
 *   photos taken earlier.
 * A single input with `capture` would remove the library on iOS and Android;
 * a single input without it puts the camera one menu away. On a mouse-driven
 * screen the camera control is hidden (globals.css: .photo-take).
 */
export function PhotoSourcePicker({
  onFiles, accept = 'image/jpeg,image/png,image/webp,image/heic', disabled = false, chooseLabel = 'Choose photos',
}: PhotoSourcePickerProps) {
  const takeRef = useRef<HTMLInputElement>(null)
  const chooseRef = useRef<HTMLInputElement>(null)

  function picked(input: HTMLInputElement | null) {
    const files = Array.from(input?.files ?? [])
    if (input) input.value = '' // the same photo can be picked again after a remove
    if (files.length > 0) onFiles(files)
  }

  return (
    <div className="photo-source" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <label className="photo-source-btn photo-take" aria-disabled={disabled || undefined}>
        <input
          ref={takeRef}
          type="file"
          accept={accept}
          capture="environment"
          disabled={disabled}
          onChange={() => picked(takeRef.current)}
          className="photo-source-input"
        />
        <span aria-hidden="true">📷</span> Take photo
      </label>
      <label className="photo-source-btn" aria-disabled={disabled || undefined}>
        <input
          ref={chooseRef}
          type="file"
          accept={accept}
          multiple
          disabled={disabled}
          onChange={() => picked(chooseRef.current)}
          className="photo-source-input"
        />
        <span aria-hidden="true">🖼</span> {chooseLabel}
      </label>
    </div>
  )
}

/** Adds newly picked files to a list, skipping exact repeats (name + size + mtime). */
export function addPhotos(prev: File[], next: File[]): File[] {
  const key = (f: File) => `${f.name}|${f.size}|${f.lastModified}`
  const seen = new Set(prev.map(key))
  return [...prev, ...next.filter(f => !seen.has(key(f)))]
}
