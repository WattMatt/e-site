'use client'

import Link from 'next/link'
import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { generateTagsAction } from '@/actions/cable-tag.actions'

interface Props {
  revisionId: string
  missingTagsCount: number
  totalUnprinted: number
  basePath: string
  currentFilter: string | null
  currentSize: string | null
  sizes: number[]
}

export function TagControls({
  revisionId, missingTagsCount, totalUnprinted, basePath, currentFilter, currentSize, sizes,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onGenerate() {
    setError(null)
    startTransition(async () => {
      const r = await generateTagsAction(revisionId)
      if (r.error) { setError(r.error); return }
      router.refresh()
    })
  }

  function hrefWith(extra: Record<string, string | null>): string {
    const sp = new URLSearchParams()
    if (currentFilter) sp.set('filter', currentFilter)
    if (currentSize) sp.set('size', currentSize)
    for (const [k, v] of Object.entries(extra)) {
      if (v == null) sp.delete(k)
      else sp.set(k, v)
    }
    const qs = sp.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Link
        href={hrefWith({ filter: currentFilter === 'unprinted' ? null : 'unprinted' })}
        className="btn-primary-amber"
        style={{
          background: currentFilter === 'unprinted' ? 'var(--c-amber)' : 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          color: currentFilter === 'unprinted' ? 'var(--c-bg)' : 'var(--c-text-mid)',
          textDecoration: 'none',
        }}
      >
        {currentFilter === 'unprinted' ? '✓ Unprinted only' : `Unprinted (${totalUnprinted})`}
      </Link>

      <select
        value={currentSize ?? ''}
        onChange={(e) => router.push(hrefWith({ size: e.target.value || null }))}
        className="ob-input"
        style={{ width: 130 }}
      >
        <option value="">All sizes</option>
        {sizes.map((s) => <option key={s} value={s}>{s} mm²</option>)}
      </select>

      <button
        type="button"
        className="btn-primary-amber"
        onClick={onGenerate}
        disabled={pending || missingTagsCount === 0}
        title={missingTagsCount === 0
          ? 'All cables already have tags'
          : `Create ${missingTagsCount} missing tag(s)`}
      >
        {pending ? 'Generating…' : missingTagsCount === 0 ? 'All generated' : `+ Generate (${missingTagsCount})`}
      </button>

      <button
        type="button"
        className="btn-primary-amber"
        onClick={() => window.print()}
        style={{
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          color: 'var(--c-text-mid)',
        }}
      >
        ↳ Print sheet
      </button>

      {error && (
        <div role="alert" style={{ color: '#dc2626', fontSize: 11, marginLeft: 6 }}>{error}</div>
      )}
    </div>
  )
}
