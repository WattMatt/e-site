'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  photoPaths: string[]
}

export function RequisitionPhotos({ photoPaths }: Props) {
  const [urls, setUrls] = useState<Array<{ path: string; url: string | null }>>(() =>
    photoPaths.map((p) => ({ path: p, url: null })),
  )

  useEffect(() => {
    if (photoPaths.length === 0) return
    let cancelled = false
    const supabase = createClient()
    ;(async () => {
      // Batch signed URLs — `createSignedUrls` returns one per input path.
      const { data, error } = await supabase.storage
        .from('requisition-photos')
        .createSignedUrls(photoPaths, 3600)
      if (cancelled || error || !data) return
      setUrls(
        photoPaths.map((path) => {
          const match = data.find((d) => d.path === path)
          return { path, url: match?.signedUrl ?? null }
        }),
      )
    })()
    return () => { cancelled = true }
  }, [photoPaths.join(',')])

  if (photoPaths.length === 0) return null
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: 10,
    }}>
      {urls.map((u, i) => (
        <a
          key={u.path}
          href={u.url ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            aspectRatio: '1',
            borderRadius: 6,
            overflow: 'hidden',
            background: 'var(--c-base)',
            border: '1px solid var(--c-border)',
          }}
        >
          {u.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={u.url}
              alt={`Requisition photo ${i + 1}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', color: 'var(--c-text-dim)', fontSize: 11,
            }}>
              loading…
            </div>
          )}
        </a>
      ))}
    </div>
  )
}
