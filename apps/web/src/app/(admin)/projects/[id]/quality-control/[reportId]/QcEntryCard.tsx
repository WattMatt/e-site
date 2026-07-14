'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FloorPlanAttachDialog } from '@/components/attachments/FloorPlanAttachDialog'
import { replaceQcMarkup } from '@/lib/qc-photos'
import type { AnnotationData } from '@/components/attachments/types'
import { QcDeleteButton } from './QcDeleteButton'
import { QcCommentList } from './QcCommentList'
import { QcCommentForm } from './QcCommentForm'

// ─── View types (serialisable; shaped by the server page) ────────────────────

export interface QcPhotoView {
  id: string
  /** 1-based position within the entry — comments and the PDF reference "Photo N". */
  index: number
  /** 1h signed URL, created server-side (diary pattern). '' when signing failed. */
  url: string
  fileName: string | null
  caption: string | null
  kind: 'photo' | 'markup'
  uploadedBy: string
  /** Storage path within qc-report-entries — the markup replace target. */
  filePath: string
  /** Markups only: source plan for re-signing on re-edit (null when deleted/none). */
  sourceFloorPlanId: string | null
  /** Markups only: stored vector scene graph — rebuilt into the annotator on re-edit. */
  annotationData: AnnotationData | null
}

export interface QcCommentView {
  id: string
  body: string
  createdAt: string
  createdBy: string
  authorName: string | null
  /** null = comment on the whole entry/group. */
  photoId: string | null
}

export interface QcEntryView {
  id: string
  /** 1-based position within the report (sort_order sequence). */
  number: number
  title: string
  description: string | null
  createdBy: string
  createdAt: string
  authorName: string | null
  photos: QcPhotoView[]
  comments: QcCommentView[]
}

interface Props {
  entry: QcEntryView
  projectId: string
  canWrite: boolean
  canManage: boolean
  currentUserId: string
  isClosed: boolean
}

export function QcEntryCard({ entry, projectId, canWrite, canManage, currentUserId, isClosed }: Props) {
  const router = useRouter()
  const canDeleteEntry = !isClosed && (entry.createdBy === currentUserId || canManage)

  // ── Markup re-edit (spec §4): reopen the annotator seeded with the stored
  //    scene graph, then replace blob + annotation_data on the SAME photo row
  //    (client-side under RLS) — the AttachmentGallery handleReEdit pattern. ──
  const [editingMarkup, setEditingMarkup] = useState<QcPhotoView | null>(null)
  const [editingSource, setEditingSource] = useState<string | null>(null)
  const [editingPlanName, setEditingPlanName] = useState('')
  const [busyPhotoId, setBusyPhotoId] = useState<string | null>(null)
  const [markupError, setMarkupError] = useState('')

  async function handleReEditMarkup(photo: QcPhotoView) {
    if (!photo.annotationData) return
    setMarkupError('')
    setBusyPhotoId(photo.id)
    try {
      const supabase = createClient()

      // Re-sign the source floor plan URL. If the plan has been deleted, fall
      // back to the frozen signedUrl stored inside annotation_data (may be stale).
      let sourceUrl: string | null = null
      let planName = photo.fileName ?? 'Drawing markup'

      if (photo.sourceFloorPlanId) {
        const { data: plan } = await supabase
          .schema('tenants')
          .from('floor_plans')
          .select('name, level, file_path')
          .eq('id', photo.sourceFloorPlanId)
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
        sourceUrl = photo.annotationData.baseImage.signedUrl ?? null
      }

      if (!sourceUrl) {
        setMarkupError('Source floor plan is no longer accessible — cannot re-edit.')
        return
      }

      setEditingSource(sourceUrl)
      setEditingPlanName(planName)
      setEditingMarkup(photo)
    } finally {
      setBusyPhotoId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--c-amber)', marginRight: 8 }}>
                {entry.number}
              </span>
              {entry.title}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
              {entry.authorName ?? 'Unknown'} · {formatDate(entry.createdAt)}
            </p>
          </div>
          {canDeleteEntry && <QcDeleteButton kind="entry" id={entry.id} />}
        </div>
      </CardHeader>
      <CardBody>
        {entry.description && (
          <p style={{ fontSize: 13, color: 'var(--c-text)', whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: entry.photos.length ? 12 : 0 }}>
            {entry.description}
          </p>
        )}

        {markupError && (
          <p role="alert" style={{ color: 'var(--c-red)', fontSize: 12, marginBottom: 8 }}>{markupError}</p>
        )}

        {entry.photos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {entry.photos.map((photo) => {
              const canDeletePhoto = !isClosed && (photo.uploadedBy === currentUserId || canManage)
              const canEditMarkup =
                canWrite && !isClosed && photo.kind === 'markup' && !!photo.annotationData
              const isBusy = busyPhotoId === photo.id
              return (
                <div key={photo.id} style={{ width: 140, opacity: isBusy ? 0.5 : 1 }}>
                  <a href={photo.url || undefined} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.url}
                      alt={photo.fileName ?? `Photo ${photo.index}`}
                      style={{ width: 140, height: 105, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--c-border)', display: 'block' }}
                    />
                  </a>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--c-text-dim)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {photo.index}. {photo.caption ?? photo.fileName ?? ''}
                    </span>
                    {photo.kind === 'markup' && <span className="badge badge-amber">Markup</span>}
                    {canEditMarkup && (
                      <button
                        type="button"
                        onClick={() => handleReEditMarkup(photo)}
                        disabled={isBusy}
                        aria-label={`Edit markup ${photo.index}`}
                        title="Edit markup"
                        style={{
                          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
                          textTransform: 'uppercase', cursor: isBusy ? 'wait' : 'pointer',
                          background: 'transparent', color: 'var(--c-amber)',
                          border: '1px solid var(--c-amber)', borderRadius: 6, padding: '3px 8px',
                        }}
                      >
                        ✎
                      </button>
                    )}
                    {canDeletePhoto && <QcDeleteButton kind="photo" id={photo.id} label="✕" />}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <QcCommentList
          comments={entry.comments}
          photos={entry.photos}
          canManage={canManage}
          currentUserId={currentUserId}
          isClosed={isClosed}
        />

        {canWrite && !isClosed && (
          <QcCommentForm entryId={entry.id} photos={entry.photos} />
        )}
      </CardBody>

      {editingMarkup && editingSource && editingMarkup.annotationData && (
        <FloorPlanAttachDialog
          projectId={projectId}
          onClose={() => { setEditingMarkup(null); setEditingSource(null) }}
          onStage={async (staged) => {
            if (staged.kind !== 'annotation') return
            setBusyPhotoId(editingMarkup.id)
            try {
              const supabase = createClient()
              await replaceQcMarkup(
                supabase as any,
                { id: editingMarkup.id, filePath: editingMarkup.filePath },
                { blob: staged.blob, annotationData: staged.annotationData },
              )
              // Re-render the server page: freshly signed URLs bust the stale
              // thumbnail (same path, new token).
              router.refresh()
            } catch (e) {
              setMarkupError(`Save failed: ${e instanceof Error ? e.message : 'unknown error'}`)
            } finally {
              setBusyPhotoId(null)
              setEditingMarkup(null)
              setEditingSource(null)
            }
          }}
          initial={{
            sourceFloorPlanId: editingMarkup.sourceFloorPlanId,
            sourceImageUrl: editingSource,
            floorPlanName: editingPlanName || (editingMarkup.fileName ?? 'Drawing markup'),
            annotationData: editingMarkup.annotationData,
          }}
        />
      )}
    </Card>
  )
}
