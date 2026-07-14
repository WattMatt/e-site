'use client'

import { formatDate } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
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
  canWrite: boolean
  canManage: boolean
  currentUserId: string
  isClosed: boolean
}

export function QcEntryCard({ entry, canWrite, canManage, currentUserId, isClosed }: Props) {
  const canDeleteEntry = !isClosed && (entry.createdBy === currentUserId || canManage)

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

        {entry.photos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {entry.photos.map((photo) => {
              const canDeletePhoto = !isClosed && (photo.uploadedBy === currentUserId || canManage)
              return (
                <div key={photo.id} style={{ width: 140 }}>
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
    </Card>
  )
}
