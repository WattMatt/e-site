'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export type DrawingListItem = {
  id: string
  name: string
  level: string | null
  scale: string | null
  file_size_bytes: number | null
  previewUrl: string | null
  source_path: string | null
  file_path: string
}

const naturalCmp = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare

function groupKey(p: DrawingListItem): string {
  if (p.source_path) {
    const segments = p.source_path.split('/').filter(Boolean)
    if (segments.length > 1) return segments.slice(0, -1).join(' / ')
  }
  return p.level?.trim() || 'Unspecified'
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DrawingsList({
  plans,
  projectId,
}: {
  plans: DrawingListItem[]
  projectId: string
}) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'list' | 'levels'>('list')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = !q
      ? plans
      : plans.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.level ?? '').toLowerCase().includes(q) ||
            (p.source_path ?? '').toLowerCase().includes(q),
        )
    return [...base].sort((a, b) => naturalCmp(a.name, b.name))
  }, [plans, query])

  const grouped = useMemo(() => {
    const map = new Map<string, DrawingListItem[]>()
    for (const p of filtered) {
      const k = groupKey(p)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(p)
    }
    for (const items of map.values()) items.sort((a, b) => naturalCmp(a.name, b.name))
    return Array.from(map.entries()).sort((a, b) => naturalCmp(a[0], b[0]))
  }, [filtered])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, level, or folder…"
          aria-label="Search drawings"
          className="ob-input"
          style={{ flex: 1, minWidth: 220, maxWidth: 360 }}
        />
        <div
          role="tablist"
          aria-label="View mode"
          style={{
            display: 'flex',
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          {(['list', 'levels'] as const).map((mode) => {
            const active = view === mode
            return (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setView(mode)}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  padding: '7px 14px',
                  background: active ? 'var(--c-amber-mid)' : 'var(--c-panel)',
                  color: active ? 'var(--c-amber)' : 'var(--c-text-mid)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {mode === 'list' ? 'List' : 'By folder'}
              </button>
            )
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
            {query
              ? `No drawings match “${query}”`
              : '🗺️ No floor plans yet — upload a drawing to start placing snags and markups on the plan'}
          </div>
        </div>
      ) : view === 'list' ? (
        <Grid plans={filtered} projectId={projectId} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {grouped.map(([level, items]) => (
            <section key={level}>
              <h2
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--c-text-mid)',
                  marginBottom: 10,
                }}
              >
                {level}
                <span style={{ color: 'var(--c-text-dim)', marginLeft: 6 }}>{items.length}</span>
              </h2>
              <Grid plans={items} projectId={projectId} />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function Grid({ plans, projectId }: { plans: DrawingListItem[]; projectId: string }) {
  return (
    <div
      className="data-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {plans.map((plan, i) => (
        <Row key={plan.id} plan={plan} projectId={projectId} isLast={i === plans.length - 1} />
      ))}
    </div>
  )
}

function Row({
  plan,
  projectId,
  isLast,
}: {
  plan: DrawingListItem
  projectId: string
  isLast: boolean
}) {
  // Row uses a div (not a Link) so the inline download <button> doesn't end
  // up nested inside an <a> (invalid HTML). The name+metadata is wrapped in
  // its own Link; the download button is a sibling.
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 16px',
        borderBottom: isLast ? 'none' : '1px solid var(--c-border)',
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden="true">📄</span>
      <Link
        href={`/projects/${projectId}/floor-plans/${plan.id}`}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'block',
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--c-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {plan.name}
        </div>
        {(plan.source_path || plan.level) && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--c-text-dim)',
              marginTop: 2,
              letterSpacing: '0.04em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {plan.source_path ?? plan.level}
          </div>
        )}
      </Link>
      <div
        style={{
          display: 'flex',
          gap: 14,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--c-text-dim)',
          flexShrink: 0,
        }}
      >
        {plan.scale && <span>Scale {plan.scale}</span>}
        {plan.file_size_bytes && <span>{formatBytes(plan.file_size_bytes)}</span>}
      </div>
      <DownloadButton filePath={plan.file_path} name={plan.name} />
      <Link
        href={`/projects/${projectId}/floor-plans/${plan.id}`}
        aria-label={`Open ${plan.name}`}
        style={{
          color: 'var(--c-text-dim)',
          fontSize: 12,
          flexShrink: 0,
          textDecoration: 'none',
        }}
      >
        ›
      </Link>
    </div>
  )
}

function DownloadButton({ filePath, name }: { filePath: string; name: string }) {
  const [busy, setBusy] = useState(false)
  async function onClick() {
    if (busy) return
    setBusy(true)
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )
      const { data, error } = await supabase.storage
        .from('drawings')
        .createSignedUrl(filePath, 3600, { download: name })
      if (error || !data?.signedUrl) {
        alert(`Cannot download: ${error?.message ?? 'no URL'}`)
        return
      }
      // Trigger the download via a hidden anchor; `?download=` query param
      // is added by Supabase Storage when we pass { download } to
      // createSignedUrl, which forces a Content-Disposition: attachment
      // header rather than inline preview.
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={`Download ${name}`}
      title="Download original file"
      style={{
        background: 'none',
        border: '1px solid var(--c-border)',
        borderRadius: 6,
        color: 'var(--c-text-mid)',
        cursor: busy ? 'progress' : 'pointer',
        padding: '4px 8px',
        fontSize: 12,
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.04em',
      }}
    >
      {busy ? '…' : '↓'}
    </button>
  )
}
