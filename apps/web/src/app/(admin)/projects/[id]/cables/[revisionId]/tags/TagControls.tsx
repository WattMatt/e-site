'use client'

import Link from 'next/link'
import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { generateTagsAction, regenerateTagTextAction } from '@/actions/cable-tag.actions'

interface Props {
  revisionId: string
  projectId: string  // ← NEW: needed for the tag-list PDF download URL
  missingTagsCount: number
  totalUnprinted: number
  basePath: string
  currentFilter: string | null
  currentSize: string | null
  sizes: number[]
}

export function TagControls({
  revisionId, projectId, missingTagsCount, totalUnprinted, basePath, currentFilter, currentSize, sizes,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [regenResult, setRegenResult] = useState<string | null>(null)

  function onGenerate() {
    setError(null)
    startTransition(async () => {
      const r = await generateTagsAction(revisionId)
      if (r.error) { setError(r.error); return }
      router.refresh()
    })
  }

  function onRegenerate() {
    setError(null)
    setRegenResult(null)
    setRegenerating(true)
    startTransition(async () => {
      const r = await regenerateTagTextAction(revisionId)
      setRegenerating(false)
      if (!r.ok) {
        setError(r.error)
        return
      }
      setRegenResult(`Regenerated tag_text for ${r.updated} tag${r.updated !== 1 ? 's' : ''}`)
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
        onClick={onRegenerate}
        disabled={pending || regenerating}
        style={{
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          color: 'var(--c-text-mid)',
        }}
        title="Recompute tag_text for existing tags using current board short codes"
      >
        {regenerating ? 'Regenerating…' : '↻ Regenerate tag text'}
      </button>

      {regenResult && (
        <div role="status" style={{ color: 'var(--c-green)', fontSize: 11, marginLeft: 6 }}>{regenResult}</div>
      )}

      {/* Programmatic fetch + Blob download. <a download> silently discards
          on any non-200 response (redirects, errors), masking real failures.
          fetch + status-check surfaces the actual response — auth redirects,
          policy denials, size-guard 413s all become visible errors instead
          of "nothing happens". */}
      <button
        type="button"
        className="btn-primary-amber"
        disabled={downloading}
        onClick={async () => {
          setError(null)
          setDownloading(true)
          try {
            const url = `/api/cable-schedule/export/tag-list/pdf?projectId=${projectId}&revisionId=${revisionId}`
            const r = await fetch(url, { credentials: 'include' })
            if (!r.ok) {
              // Read body for diagnostic; truncate for the inline error UI.
              let detail = ''
              try {
                const text = await r.text()
                detail = text.length > 120 ? text.slice(0, 120) + '…' : text
              } catch {
                detail = r.statusText
              }
              setError(`Download failed (HTTP ${r.status}): ${detail || r.statusText}`)
              return
            }
            const blob = await r.blob()
            if (blob.size === 0) {
              setError('Download failed: server returned an empty file')
              return
            }
            // Derive filename from Content-Disposition (server-set) when
            // present; fall back to a sane default.
            const cd = r.headers.get('content-disposition') ?? ''
            const match = /filename="([^"]+)"/.exec(cd)
            const filename = match?.[1] ?? `tag-list-${revisionId.slice(0, 8)}.pdf`

            const blobUrl = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = blobUrl
            link.download = filename
            document.body.appendChild(link)
            link.click()
            link.remove()
            URL.revokeObjectURL(blobUrl)
          } catch (e) {
            setError(`Download failed: ${e instanceof Error ? e.message : String(e)}`)
          } finally {
            setDownloading(false)
          }
        }}
        style={{
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          color: 'var(--c-text-mid)',
        }}
      >
        {downloading ? 'Downloading…' : '↓ Download list (PDF)'}
      </button>

      {error && (
        <div role="alert" style={{ color: 'var(--c-red)', fontSize: 11, marginLeft: 6 }}>{error}</div>
      )}
    </div>
  )
}
