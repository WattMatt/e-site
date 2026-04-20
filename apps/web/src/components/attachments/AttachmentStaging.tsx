'use client'

import { useEffect, useState } from 'react'
import { Paperclip, Map, X, FileText } from 'lucide-react'
import { PhotoPicker } from '@/components/ui/PhotoPicker'
import { FloorPlanAttachDialog } from './FloorPlanAttachDialog'
import type { StagedAttachment } from './types'

interface Props {
  projectId: string | null
  value: StagedAttachment[]
  onChange: (next: StagedAttachment[]) => void
  // Cap total count (UX guard — not a security limit).
  maxItems?: number
  // Hide the "+ Attach floor plan" action when there's no project yet.
  allowFloorPlan?: boolean
}

export function AttachmentStaging({
  projectId,
  value,
  onChange,
  maxItems = 10,
  allowFloorPlan = true,
}: Props) {
  const [floorPlanOpen, setFloorPlanOpen] = useState(false)

  // Clean up object URLs when items are removed / on unmount.
  useEffect(() => {
    return () => {
      for (const item of value) URL.revokeObjectURL(item.previewUrl)
    }
    // We intentionally don't re-run this on value change — per-item cleanup
    // happens in handleRemove. This effect only guards unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleFiles(files: File[]) {
    const next: StagedAttachment[] = []
    for (const file of files) {
      if (value.length + next.length >= maxItems) break
      next.push({
        kind: 'file',
        id: Math.random().toString(36).slice(2, 10),
        file,
        previewUrl: URL.createObjectURL(file),
      })
    }
    onChange([...value, ...next])
  }

  function handleRemove(id: string) {
    const victim = value.find(v => v.id === id)
    if (victim) URL.revokeObjectURL(victim.previewUrl)
    onChange(value.filter(v => v.id !== id))
  }

  const roomLeft = Math.max(0, maxItems - value.length)
  const pickerDisabled = roomLeft === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--c-text-mid)', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Paperclip size={13} /> Attachments
        </span>
        {value.length > 0 && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
            {value.length}/{maxItems}
          </span>
        )}
        {allowFloorPlan && projectId && (
          <button
            type="button"
            onClick={() => setFloorPlanOpen(true)}
            disabled={pickerDisabled}
            style={{
              marginLeft: 'auto',
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 11px', borderRadius: 6,
              background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber)',
              color: 'var(--c-amber)', fontSize: 11, fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em', cursor: pickerDisabled ? 'not-allowed' : 'pointer',
              opacity: pickerDisabled ? 0.5 : 1,
            }}
          >
            <Map size={13} /> Attach floor plan
          </button>
        )}
      </div>

      <PhotoPicker
        label="Add photos or PDFs"
        accept="image/*,application/pdf"
        multiple
        maxSizeMB={20}
        disabled={pickerDisabled}
        onFilesSelected={handleFiles}
      />

      {value.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8,
        }}>
          {value.map(item => (
            <StagedTile key={item.id} item={item} onRemove={() => handleRemove(item.id)} />
          ))}
        </div>
      )}

      {floorPlanOpen && projectId && (
        <FloorPlanAttachDialog
          projectId={projectId}
          onClose={() => setFloorPlanOpen(false)}
          onStage={staged => {
            if (value.length >= maxItems) { setFloorPlanOpen(false); return }
            onChange([...value, staged])
            setFloorPlanOpen(false)
          }}
        />
      )}
    </div>
  )
}

function StagedTile({ item, onRemove }: { item: StagedAttachment; onRemove: () => void }) {
  const isImage = item.kind === 'annotation' || (item.kind === 'file' && item.file.type.startsWith('image/'))
  const isPdf   = item.kind === 'file' && item.file.type === 'application/pdf'
  const label   = item.kind === 'annotation' ? item.fileName : item.file.name
  const tag     = item.kind === 'annotation' ? 'MARKUP' : null

  return (
    <div style={{
      position: 'relative',
      background: 'var(--c-base)', border: '1px solid var(--c-border)',
      borderRadius: 8, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        aspectRatio: '1 / 1', background: 'var(--c-surface, #13131E)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {isImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.previewUrl} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {isPdf && <FileText size={28} color="var(--c-text-dim)" />}
        {!isImage && !isPdf && <FileText size={28} color="var(--c-text-dim)" />}
      </div>
      {tag && (
        <span style={{
          position: 'absolute', top: 4, left: 4,
          fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
          letterSpacing: '0.08em', padding: '2px 5px', borderRadius: 3,
          background: 'var(--c-amber)', color: '#0B0B12',
        }}>{tag}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        style={{
          position: 'absolute', top: 4, right: 4,
          width: 22, height: 22, borderRadius: 4,
          background: 'rgba(11,11,18,0.8)', border: '1px solid var(--c-border)',
          color: 'var(--c-text)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        }}
      >
        <X size={12} />
      </button>
      <div style={{ padding: '5px 7px', borderTop: '1px solid var(--c-border)' }}>
        <div style={{
          fontSize: 10, color: 'var(--c-text)', lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={label}>
          {label}
        </div>
      </div>
    </div>
  )
}
