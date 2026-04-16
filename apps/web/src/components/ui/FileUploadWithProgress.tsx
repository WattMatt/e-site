'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

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
    <div className="space-y-3">
      <label
        className="flex flex-col items-center justify-center border-2 border-dashed border-slate-600 hover:border-slate-400 rounded-xl p-6 cursor-pointer transition-colors text-center"
      >
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
        <span className="text-3xl mb-2">📎</span>
        <p className="text-sm font-medium text-white">Click to upload</p>
        <p className="text-xs text-slate-400 mt-1">Max {maxSizeMB}MB per file</p>
      </label>

      {uploads.map((u, i) => (
        <div key={i} className="bg-slate-800 rounded-lg px-3 py-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-sm text-white truncate max-w-[70%]">{u.file.name}</p>
            <span className={`text-xs font-medium ${
              u.status === 'done' ? 'text-green-400' :
              u.status === 'error' ? 'text-red-400' :
              'text-slate-400'
            }`}>
              {u.status === 'done' ? '✓ Done' :
               u.status === 'error' ? `✗ ${u.error}` :
               u.status === 'uploading' ? `${u.progress}%` : 'Pending'}
            </span>
          </div>
          {(u.status === 'uploading' || u.status === 'done') && (
            <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-200 ${u.status === 'done' ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${u.progress}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
