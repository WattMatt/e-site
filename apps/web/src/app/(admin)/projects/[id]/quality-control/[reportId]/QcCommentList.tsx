'use client'

import { formatDate } from '@esite/shared'
import { QcDeleteButton } from './QcDeleteButton'
import type { QcCommentView, QcPhotoView } from './QcEntryCard'

interface Props {
  comments: QcCommentView[]
  /** The entry's photos — used to label per-photo comments with thumbnail + name. */
  photos: QcPhotoView[]
  canManage: boolean
  currentUserId: string
  isClosed: boolean
}

/** Chronological comment thread for one entry: group comments plus per-photo
 *  comments labelled with the referenced photo's thumbnail/number. */
export function QcCommentList({ comments, photos, canManage, currentUserId, isClosed }: Props) {
  if (comments.length === 0) return null

  const photoById = new Map(photos.map((p) => [p.id, p]))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--c-border)' }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-dim)' }}>
        Comments
      </p>
      {comments.map((c) => {
        const photo = c.photoId ? photoById.get(c.photoId) : undefined
        const canDelete = !isClosed && (c.createdBy === currentUserId || canManage)
        return (
          <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo.url}
                alt={photo.fileName ?? `Photo ${photo.index}`}
                style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--c-border)', flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginBottom: 2 }}>
                {c.authorName ?? 'Unknown'} · {formatDate(c.createdAt)}
                {photo && (
                  <span style={{ color: 'var(--c-amber)' }}>
                    {' '}· {photo.kind === 'markup' ? 'Markup' : 'Photo'} {photo.index}{photo.fileName ? ` — ${photo.fileName}` : ''}
                  </span>
                )}
              </p>
              <p style={{ fontSize: 13, color: 'var(--c-text)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{c.body}</p>
            </div>
            {canDelete && <QcDeleteButton kind="comment" id={c.id} />}
          </div>
        )
      })}
    </div>
  )
}
