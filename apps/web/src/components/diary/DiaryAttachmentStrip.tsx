'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { diaryService } from '@esite/shared'
import type { DiaryAttachment } from '@esite/shared'
import { uploadDiaryAttachments, DIARY_ATTACHMENT_ACCEPT_DOC } from '@/lib/diary-attachments'

/** A diary attachment plus a signed URL generated server-side. */
export interface DiaryAttachmentView extends DiaryAttachment {
  url: string
}

interface Props {
  entryId: string
  orgId: string
  projectId: string
  userId: string
  attachments: DiaryAttachmentView[]
  canEdit: boolean
}

export function DiaryAttachmentStrip({ entryId, orgId, projectId, userId, attachments, canEdit }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lightbox, setLightbox] = useState<DiaryAttachmentView | null>(null)

  async function onAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setBusy(true)
    setError('')
    try {
      const client = createClient()
      await uploadDiaryAttachments(client as never, { orgId, projectId, entryId, userId, files })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(att: DiaryAttachmentView) {
    if (!window.confirm(`Delete "${att.file_name}"?`)) return
    setBusy(true)
    setError('')
    try {
      const client = createClient()
      await diaryService.deleteAttachment(client as never, att)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setBusy(false)
    }
  }

  if (attachments.length === 0 && !canEdit) return null

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--c-text-dim)', marginBottom: 6,
      }}>
        Attachments
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {attachments.map(att => (
          <div key={att.id} style={{ position: 'relative', width: 96 }}>
            {att.kind === 'image' && (
              <img
                src={att.url}
                alt={att.file_name}
                onClick={() => setLightbox(att)}
                style={{
                  width: 96, height: 96, objectFit: 'cover', borderRadius: 6,
                  border: '1px solid var(--c-border)', cursor: 'pointer',
                }}
              />
            )}
            {att.kind === 'video' && (
              <div
                onClick={() => setLightbox(att)}
                style={{
                  width: 96, height: 96, borderRadius: 6, border: '1px solid var(--c-border)',
                  background: 'var(--c-elevated)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', cursor: 'pointer', fontSize: 24, color: 'var(--c-text-mid)',
                }}
              >▶</div>
            )}
            {att.kind === 'document' && (
              <a
                href={att.url}
                target="_blank"
                rel="noreferrer"
                title={att.file_name}
                style={{
                  width: 96, height: 96, borderRadius: 6, border: '1px solid var(--c-border)',
                  background: 'var(--c-elevated)', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', textDecoration: 'none',
                  color: 'var(--c-text-mid)', fontSize: 10, padding: 4, textAlign: 'center',
                }}
              >
                <span style={{ fontSize: 22 }}>📄</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                  {att.file_name}
                </span>
              </a>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => onDelete(att)}
                disabled={busy}
                aria-label={`Delete ${att.file_name}`}
                style={{
                  position: 'absolute', top: -6, right: -6, width: 20, height: 20,
                  borderRadius: '50%', border: '1px solid var(--c-border)',
                  background: 'var(--c-panel)', color: 'var(--c-red)', cursor: 'pointer',
                  fontSize: 11, lineHeight: 1,
                }}
              >✕</button>
            )}
          </div>
        ))}
        {canEdit && ([
          { label: '📷 Photo', accept: 'image/*' },
          { label: '🎥 Video', accept: 'video/*' },
          { label: '📄 Doc', accept: DIARY_ATTACHMENT_ACCEPT_DOC },
        ] as const).map(ctrl => (
          <label
            key={ctrl.label}
            style={{
              width: 96, height: 96, borderRadius: 6, border: '1px dashed var(--c-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: busy ? 'wait' : 'pointer', color: 'var(--c-text-dim)', fontSize: 11, textAlign: 'center',
            }}
          >
            {busy ? '…' : ctrl.label}
            <input
              type="file"
              multiple
              accept={ctrl.accept}
              onChange={onAdd}
              disabled={busy}
              style={{ display: 'none' }}
            />
          </label>
        ))}
      </div>
      {error && <p style={{ color: 'var(--c-red)', fontSize: 11, marginTop: 4 }}>{error}</p>}

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
          }}
        >
          {lightbox.kind === 'image'
            ? <img src={lightbox.url} alt={lightbox.file_name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <video src={lightbox.url} controls autoPlay style={{ maxWidth: '100%', maxHeight: '100%' }} />}
        </div>
      )}
    </div>
  )
}
