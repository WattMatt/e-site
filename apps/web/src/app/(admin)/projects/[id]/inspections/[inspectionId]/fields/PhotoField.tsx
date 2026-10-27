'use client'

import type { RendererProps } from '../FieldRenderer'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useFieldPhotos, type FieldPhoto } from './useFieldPhotos'
import PhotoMarkupDialog from './PhotoMarkupDialog'
import { assessedResult } from '@esite/shared'
import { PhotoLightbox, type LightboxPhoto } from '../PhotoLightbox'
import { PHOTO_ACCEPT } from '@/lib/image/prepare'

export default function PhotoField({ field, inspectionId, sectionId, readOnly, response, onChange }: RendererProps) {
  const { photos, uploading, error, upload, remove } = useFieldPhotos(
    inspectionId,
    sectionId,
    field.field_id,
  )
  const [lightbox, setLightbox] = useState<{ index: number } | null>(null)
  // Two-step inline confirmation — first × tap arms it; second tap deletes.
  // Avoids window.confirm() entirely (it can be silently suppressed by Safari).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const params = useParams<{ id?: string }>()
  const [markingUp, setMarkingUp] = useState<FieldPhoto | null>(null)
  const assessed = !!field.assess

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
        {field.label}
        {field.required && <span style={{ color: 'var(--c-red)', marginLeft: 4 }}>*</span>}
      </label>
      {field.help_text && (
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>{field.help_text}</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {photos.map(
          (p, i) =>
            p.signed_url && (
              <div key={p.id} style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setLightbox({ index: i })}
                  style={{
                    padding: 0,
                    border: 'none',
                    background: 'none',
                    cursor: 'zoom-in',
                    borderRadius: 6,
                    overflow: 'hidden',
                    width: '100%',
                    display: 'block',
                  }}
                  aria-label="View photo full size"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.signed_url}
                    alt=""
                    style={{
                      width: '100%',
                      height: 96,
                      objectFit: 'cover',
                      borderRadius: 6,
                      border: '1px solid var(--c-border)',
                      display: 'block',
                    }}
                  />
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirmDeleteId === p.id) {
                        remove(p.id)
                        setConfirmDeleteId(null)
                      } else {
                        setConfirmDeleteId(p.id)
                        setTimeout(() => {
                          setConfirmDeleteId((curr) => (curr === p.id ? null : curr))
                        }, 3000)
                      }
                    }}
                    aria-label={confirmDeleteId === p.id ? 'Tap again to confirm delete' : 'Delete photo'}
                    title={confirmDeleteId === p.id ? 'Tap again to confirm' : 'Delete photo'}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      height: 26,
                      minWidth: 26,
                      padding: confirmDeleteId === p.id ? '0 10px' : 0,
                      borderRadius: 13,
                      background: confirmDeleteId === p.id ? '#7f1d1d' : 'rgba(220, 38, 38, 0.95)',
                      color: '#fff',
                      border: '1px solid rgba(255,255,255,0.9)',
                      fontSize: confirmDeleteId === p.id ? 11 : 16,
                      fontWeight: 700,
                      lineHeight: 1,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      whiteSpace: 'nowrap',
                      zIndex: 10,
                    }}
                  >
                    {confirmDeleteId === p.id ? 'Tap to delete' : '×'}
                  </button>
                )}
                {p.caption === 'Markup' && (
                  <span
                    style={{
                      position: 'absolute', left: 4, top: 4, fontSize: 10, fontWeight: 700, padding: '1px 6px',
                      borderRadius: 4, background: 'rgba(192,57,43,0.95)', color: '#fff',
                    }}
                  >
                    Markup
                  </span>
                )}
                {assessed && !readOnly && p.caption !== 'Markup' && typeof params?.id === 'string' && (
                  <button
                    type="button"
                    onClick={() => setMarkingUp(p)}
                    style={{
                      marginTop: 4, width: '100%', fontSize: 11, padding: '4px 6px', borderRadius: 4,
                      border: '1px solid var(--c-border)', background: 'var(--c-panel)', color: 'var(--c-text-mid)', cursor: 'pointer',
                    }}
                  >
                    ✎ Mark up where
                  </button>
                )}
              </div>
            ),
        )}
        {!readOnly && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: 96,
              border: '2px dashed var(--c-border)',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 11,
              color: 'var(--c-text-dim)',
            }}
          >
            {uploading ? 'Uploading…' : '+ Add photo'}
            <input
              type="file"
              accept={PHOTO_ACCEPT}
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </label>
        )}
      </div>
      {error && <p style={{ fontSize: 11, color: 'var(--c-red)', margin: 0 }}>{error}</p>}
      {/* An assessed item: Pass / Fail / N/A and a comment. Otherwise a required photo that can't be
          taken never blocks or fails the inspection; its reason (optional) is kept on this field's
          answer as value_text and printed in the report. */}
      {assessed ? (
        <PhotoAssessment
          value={response}
          readOnly={readOnly}
          hasPhoto={photos.length > 0}
          onChange={onChange}
        />
      ) : (
        field.required && photos.length === 0 && !uploading && (readOnly ? (
          response?.value_text ? (
            <p style={{ fontSize: 11, color: 'var(--c-text-mid)', margin: 0 }}>No photo: {response.value_text}</p>
          ) : null
        ) : (
          <input
            type="text"
            placeholder="No photo? Reason (optional), e.g. board locked"
            aria-label={`${field.label}: reason no photo was taken`}
            defaultValue={response?.value_text ?? ''}
            onBlur={(e) => {
              const reason = e.target.value.trim()
              if (reason !== (response?.value_text ?? '')) onChange({ value_text: reason || null })
            }}
            style={{
              fontSize: 12,
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid var(--c-border)',
              background: 'var(--c-panel)',
              color: 'var(--c-text)',
            }}
          />
        ))
      )}
      {markingUp?.signed_url && typeof params?.id === 'string' && (
        <PhotoMarkupDialog
          projectId={params.id}
          photo={{ id: markingUp.id, signed_url: markingUp.signed_url, width_px: markingUp.width_px, height_px: markingUp.height_px }}
          title={field.label}
          onSave={(png) => upload(new File([png], `markup-${Date.now()}.png`, { type: 'image/png' }), { caption: 'Markup' })}
          onClose={() => setMarkingUp(null)}
        />
      )}
      {lightbox !== null &&
        (() => {
          const lightboxPhotos: LightboxPhoto[] = photos
            .filter((p): p is typeof p & { signed_url: string } => !!p.signed_url)
            .map((p) => ({
              id: p.id,
              signed_url: p.signed_url,
              taken_at: p.taken_at,
              gps_lat: p.gps_lat,
              gps_lng: p.gps_lng,
            }))
          // Map lightbox.index (into photos[]) to the index in lightboxPhotos
          // (the signed_url-only subset).
          const signedIndex = lightboxPhotos.findIndex(
            (lp) => lp.id === photos[lightbox.index]?.id,
          )
          const safeIndex = signedIndex >= 0 ? signedIndex : 0
          return (
            <PhotoLightbox
              photos={lightboxPhotos}
              activeIndex={safeIndex}
              onChange={(i) => {
                const targetId = lightboxPhotos[i]?.id
                const originalIndex = photos.findIndex((p) => p.id === targetId)
                setLightbox({ index: originalIndex >= 0 ? originalIndex : i })
              }}
              onClose={() => setLightbox(null)}
              onDelete={!readOnly ? remove : undefined}
            />
          )
        })()}
    </div>
  )
}

const RESULTS = [
  { value: 'pass', label: '✓ Pass', color: 'var(--c-green, #45a049)', dim: 'var(--c-green-dim, rgba(69,160,73,0.12))' },
  { value: 'fail', label: '✗ Fail', color: 'var(--c-red, #c0392b)', dim: 'var(--c-red-dim, rgba(192,57,43,0.12))' },
  { value: 'na', label: 'N/A', color: 'var(--c-text-mid)', dim: 'var(--c-panel-dim, rgba(0,0,0,0.06))' },
] as const

/**
 * An assessed photo item (template `assess`): Pass / Fail / N/A plus a comment that is always
 * there — where and why, or why there is no photo. Fail fails the inspection. Every change sends
 * the result AND the comment together: the autosave writes the whole row from what it is given.
 */
function PhotoAssessment({
  value,
  readOnly,
  hasPhoto,
  onChange,
}: {
  value: RendererProps['response']
  readOnly: boolean
  hasPhoto: boolean
  onChange: RendererProps['onChange']
}) {
  const result = assessedResult(value)
  const comment = value?.value_text ?? ''
  const write = (next: 'pass' | 'fail' | 'na' | null, text: string) =>
    onChange({
      value_bool: next === 'pass' ? true : next === 'fail' ? false : null,
      pass_state: next ?? 'not_checked',
      value_text: text.trim() || null,
    })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div role="radiogroup" aria-label="Result" style={{ display: 'flex', gap: 8 }}>
        {RESULTS.map((r) => {
          const on = result === r.value
          return (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={readOnly}
              onClick={() => write(r.value, comment)}
              style={{
                flex: 1, padding: '6px 10px', borderRadius: 6, fontSize: 12,
                border: on ? `1px solid ${r.color}` : '1px solid var(--c-border)',
                background: on ? r.dim : 'var(--c-panel)',
                color: on ? r.color : 'var(--c-text-mid)',
                fontWeight: on ? 600 : 400,
                cursor: readOnly ? 'not-allowed' : 'pointer',
                opacity: readOnly ? 0.6 : 1,
              }}
            >
              {r.label}
            </button>
          )
        })}
      </div>
      {readOnly ? (
        comment ? <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: 0 }}>{comment}</p> : null
      ) : (
        <textarea
          key={comment}
          rows={2}
          placeholder={
            result === 'fail'
              ? 'Where is the fault, and why does it fail?'
              : hasPhoto
                ? 'Comment (optional)'
                : 'No photo? Say why (optional)'
          }
          aria-label="Comment"
          defaultValue={comment}
          onBlur={(e) => {
            if (e.target.value.trim() !== comment.trim()) write(result, e.target.value)
          }}
          style={{
            fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--c-border)',
            background: 'var(--c-panel)', color: 'var(--c-text)', resize: 'vertical',
          }}
        />
      )}
      {result === 'fail' && (
        <p style={{ fontSize: 11, color: 'var(--c-red)', margin: 0 }}>Fail fails the inspection.</p>
      )}
    </div>
  )
}
