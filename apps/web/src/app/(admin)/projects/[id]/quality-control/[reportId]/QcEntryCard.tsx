'use client'

import { useState } from 'react'
import { formatDate } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { QcMarkupDialog } from './QcMarkupDialog'
import { toSceneGraph, type QcMarkupData } from '@/lib/qc-photos'
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
  /** Markups only: stored vector scene graph — rebuilt into MarkupCanvas on
   *  re-edit. New markups store a SceneGraph; legacy rows an AnnotationData
   *  (normalised by toSceneGraph). */
  annotationData: QcMarkupData | null
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
  const canDeleteEntry = !isClosed && (entry.createdBy === currentUserId || canManage)

  // ── Markup re-edit (spec §4): reopen the full MarkupCanvas seeded with the
  //    stored scene graph. QcMarkupDialog re-signs the source plan for the
  //    canvas and replaces blob + annotation_data on the SAME photo row on save.
  //    The card only resolves a display name for the source plan here. ──
  const [editingMarkup, setEditingMarkup] = useState<QcPhotoView | null>(null)
  const [editingPlanName, setEditingPlanName] = useState('')
  const [busyPhotoId, setBusyPhotoId] = useState<string | null>(null)
  const [markupError, setMarkupError] = useState('')

  async function handleReEditMarkup(photo: QcPhotoView) {
    if (!photo.annotationData) return
    setMarkupError('')
    setBusyPhotoId(photo.id)
    try {
      // Resolve a nice plan name (name · level) for the dialog header. If the
      // source plan was deleted, fall back to the file name — the dialog still
      // opens (blank canvas at the scene's stored dims) so the vectors are
      // never stranded.
      let planName = photo.fileName ?? 'Drawing markup'
      if (photo.sourceFloorPlanId) {
        const supabase = createClient()
        const { data: plan } = await supabase
          .schema('tenants')
          .from('floor_plans')
          .select('name, level')
          .eq('id', photo.sourceFloorPlanId)
          .single()
        if (plan) {
          planName = `${plan.name}${plan.level ? ` · ${plan.level}` : ''}`
        }
      }
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

      {editingMarkup && editingMarkup.annotationData && (
        <QcMarkupDialog
          projectId={projectId}
          onClose={() => setEditingMarkup(null)}
          reEdit={{
            photoId: editingMarkup.id,
            filePath: editingMarkup.filePath,
            sourceFloorPlanId: editingMarkup.sourceFloorPlanId,
            initialScene: toSceneGraph(editingMarkup.annotationData),
            planName: editingPlanName || (editingMarkup.fileName ?? 'Drawing markup'),
          }}
        />
      )}
    </Card>
  )
}
