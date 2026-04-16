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
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault()
          setDragging(false)
          if (!disabled) processFiles(e.dataTransfer.files)
        }}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
          disabled ? 'opacity-50 cursor-not-allowed border-slate-700' :
          dragging ? 'border-blue-500 bg-blue-950/20' :
          'border-slate-600 hover:border-slate-400 hover:bg-slate-800/40'
        }`}
      >
        <div className="text-3xl mb-2">📷</div>
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-slate-400 mt-1">
          Click or drag & drop · Max {maxSizeMB}MB per file
        </p>
      </div>
      {error && <p className="text-red-400 text-xs mt-1.5">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        disabled={disabled}
        onChange={e => processFiles(e.target.files)}
      />
    </div>
  )
}
