'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Map, Trash2, X, Pencil, Download } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { FloorPlanAttachDialog } from './FloorPlanAttachDialog'
import { replaceAnnotation, deleteAttachment } from './commit'
import type { PersistedAttachment } from './types'

interface Props {
  attachments: PersistedAttachment[]
  // Viewer permissions — deleting + re-editing gated on write access.
  canEdit: boolean
  projectId: string
}

const IMG_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic']

export function AttachmentGallery({ attachments, canEdit, projectId }: Props) {
  const router = useRouter()
  const [lightbox, setLightbox] = useState<PersistedAttachment | null>(null)
  const [editing, setEditing]   = useState<PersistedAttachment | null>(null)
  const [editingSource, setEditingSource] = useState<string | null>(null)
  const [editingPlanName, setEditingPlanName] = useState<string>('')
  const [busyId, setBusyId] = useState<string | null>(null)

  if (attachments.length === 0) return null

  async function handleReEdit(a: PersistedAttachment) {
    if (!a.annotation) return
    const supabase = createClient()

    // Re-fetch the source floor plan URL. If the plan has been deleted, fall
    // back to the frozen signedUrl stored inside annotation_data.
    let sourceUrl: string | null = null
    let planName = a.file_name

    if (a.annotation.source_floor_plan_id) {
      const { data: plan } = await supabase
        .schema('tenants')
        .from('floor_plans')
        .select('name, level, file_path')
        .eq('id', a.annotation.source_floor_plan_id)
        .single()

      if (plan) {
        planName = `${plan.name}${plan.level ? ` · ${plan.level}` : ''}`
        const { data: signed } = await supabase.storage
          .from('drawings')
          .createSignedUrl(plan.file_path, 60 * 60)
        sourceUrl = signed?.signedUrl ?? null
      }
    }

    if (!sourceUrl) {
      // Fallback to the frozen URL captured at initial annotation time (may be stale).
      sourceUrl = a.annotation.annotation_data.baseImage.signedUrl ?? null
    }

    if (!sourceUrl) {
      alert('Source floor plan is no longer accessible — cannot re-edit.')
      return
    }

    setEditingSource(sourceUrl)
    setEditingPlanName(planName)
    setEditing(a)
  }

  async function handleDelete(a: PersistedAttachment) {
    if (!confirm(`Delete "${a.file_name}"? This cannot be undone.`)) return
    setBusyId(a.id)
    try {
      const supabase = createClient()
      await deleteAttachment({ supabase, attachmentId: a.id, filePath: a.file_path })
      router.refresh()
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
        gap: 8,
      }}>
        {attachments.map(a => {
          const isImage = a.mime_type && IMG_MIMES.includes(a.mime_type)
          const isAnnotation = !!a.annotation
          const isBusy = busyId === a.id

          return (
            <div
              key={a.id}
              style={{
                position: 'relative',
                background: 'var(--c-base)', border: '1px solid var(--c-border)',
                borderRadius: 8, overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
                opacity: isBusy ? 0.5 : 1,
              }}
            >
              <button
                type="button"
                onClick={() => isImage && setLightbox(a)}
                disabled={!isImage}
                style={{
                  aspectRatio: '1 / 1', background: 'var(--c-surface, #13131E)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden', padding: 0, border: 0,
                  cursor: isImage ? 'zoom-in' : 'default',
                }}
              >
                {isImage && a.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.signedUrl} alt={a.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <FileText size={28} color="var(--c-text-dim)" />
                )}
              </button>

              {isAnnotation && (
                <span style={{
                  position: 'absolute', top: 4, left: 4,
                  fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
                  letterSpacing: '0.08em', padding: '2px 5px', borderRadius: 3,
                  background: 'var(--c-amber)', color: '#0B0B12',
                  display: 'flex', alignItems: 'center', gap: 3,
                }}>
                  <Map size={9} /> MARKUP
                </span>
              )}

              <div style={{ padding: '5px 7px', borderTop: '1px solid var(--c-border)' }}>
                <div style={{
                  fontSize: 10, color: 'var(--c-text)', lineHeight: 1.3,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }} title={a.file_name}>
                  {a.file_name}
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginTop: 4, gap: 4,
                }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {a.signedUrl && (
                      <a
                        href={a.signedUrl}
                        download={a.file_name}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Download ${a.file_name}`}
                        style={{
                          display: 'flex', alignItems: 'center',
                          width: 22, height: 22, borderRadius: 4,
                          background: 'transparent', border: '1px solid var(--c-border)',
                          color: 'var(--c-text-mid)', justifyContent: 'center',
                        }}
                      >
                        <Download size={11} />
                      </a>
                    )}
                    {canEdit && isAnnotation && (
                      <button
                        type="button"
                        onClick={() => handleReEdit(a)}
                        disabled={isBusy}
                        aria-label="Re-edit markup"
                        style={{
                          display: 'flex', alignItems: 'center',
                          width: 22, height: 22, borderRadius: 4,
                          background: 'transparent', border: '1px solid var(--c-amber)',
                          color: 'var(--c-amber)', justifyContent: 'center', cursor: 'pointer',
                        }}
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => handleDelete(a)}
                      disabled={isBusy}
                      aria-label={`Delete ${a.file_name}`}
                      style={{
                        display: 'flex', alignItems: 'center',
                        width: 22, height: 22, borderRadius: 4,
                        background: 'transparent', border: '1px solid var(--c-border)',
                        color: '#fca5a5', justifyContent: 'center', cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 75,
            background: 'rgba(11,11,18,0.92)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
          }}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close"
            style={{
              position: 'fixed', top: 16, right: 16,
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', borderRadius: 6,
              background: 'var(--c-panel)', border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)', fontSize: 12, cursor: 'pointer',
            }}
          >
            <X size={14} /> Close
          </button>
          {lightbox.signedUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.signedUrl}
              alt={lightbox.file_name}
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          )}
        </div>
      )}

      {editing && editingSource && editing.annotation && (
        <FloorPlanAttachDialog
          projectId={projectId}
          onClose={() => { setEditing(null); setEditingSource(null) }}
          onStage={async staged => {
            if (staged.kind !== 'annotation') return
            setBusyId(editing.id)
            try {
              const supabase = createClient()
              await replaceAnnotation({
                supabase,
                attachmentId: editing.id,
                annotationId: editing.annotation!.id,
                blob: staged.blob,
                annotationData: staged.annotationData,
              })
              router.refresh()
            } catch (e) {
              alert(`Save failed: ${e instanceof Error ? e.message : 'unknown error'}`)
            } finally {
              setBusyId(null)
              setEditing(null)
              setEditingSource(null)
            }
          }}
          initial={{
            sourceFloorPlanId: editing.annotation.source_floor_plan_id,
            sourceImageUrl: editingSource,
            floorPlanName: editingPlanName || editing.file_name,
            annotationData: editing.annotation.annotation_data,
          }}
        />
      )}
    </>
  )
}
