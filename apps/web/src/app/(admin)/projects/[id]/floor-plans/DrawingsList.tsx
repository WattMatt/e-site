'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { updateFloorPlanToLatestAction } from '@/actions/cloud-storage.actions'

export type DrawingListItem = {
  id: string
  name: string
  level: string | null
  scale: string | null
  file_size_bytes: number | null
  previewUrl: string | null
  source_path: string | null
  file_path: string
  has_newer_version: boolean
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
  // Three explicit, separate row actions: View (signed URL in new tab),
  // Markup (navigate to canvas), Download (forced Content-Disposition).
  // The name + metadata are display-only — no implicit default action.
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
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
          </span>
          {plan.has_newer_version && (
            <span
              title="A newer revision is available from the linked cloud folder"
              style={{
                flexShrink: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--c-amber)',
                background: 'var(--c-amber-mid)',
                border: '1px solid var(--c-amber)',
                borderRadius: 4,
                padding: '2px 6px',
              }}
            >
              Newer available
            </span>
          )}
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
      </div>
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
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {plan.has_newer_version && (
          <UpdateButton projectId={projectId} planId={plan.id} name={plan.name} />
        )}
        <ViewLink projectId={projectId} planId={plan.id} name={plan.name} />
        <MarkupLink projectId={projectId} planId={plan.id} name={plan.name} />
        <DownloadButton filePath={plan.file_path} name={plan.name} />
      </div>
    </div>
  )
}

const actionButtonStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  color: 'var(--c-text-mid)',
  padding: '4px 10px',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  textDecoration: 'none',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  whiteSpace: 'nowrap',
}

function ViewLink({
  projectId,
  planId,
  name,
}: {
  projectId: string
  planId: string
  name: string
}) {
  // In-app preview — lands on the per-plan page in view mode (default).
  // Toolbar inside the page lets the user flow into Markup or RFI without
  // leaving the route. The previous behaviour (signed URL → window.open)
  // dropped the user into the browser's native PDF viewer, outside the app.
  return (
    <Link
      href={`/projects/${projectId}/floor-plans/${planId}`}
      aria-label={`Preview ${name}`}
      title="Open in-app preview — pan, zoom, then flow into markup or RFI"
      style={actionButtonStyle}
    >
      View
    </Link>
  )
}

function MarkupLink({
  projectId,
  planId,
  name,
}: {
  projectId: string
  planId: string
  name: string
}) {
  return (
    <Link
      href={`/projects/${projectId}/floor-plans/${planId}`}
      aria-label={`Markup ${name}`}
      title="Open the markup canvas (pen, pins, RFI tools)"
      style={actionButtonStyle}
    >
      Markup
    </Link>
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
      title="Download the original file"
      style={{ ...actionButtonStyle, cursor: busy ? 'progress' : 'pointer' }}
    >
      {busy ? '…' : '↓'}
    </button>
  )
}

function UpdateButton({
  projectId,
  planId,
  name,
}: {
  projectId: string
  planId: string
  name: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  function onClick() {
    if (pending) return
    // Warn: markup/pins/calibration stay attached but may not line up if the
    // new revision's layout differs (this is exactly why sync doesn't do it
    // automatically).
    if (
      !confirm(
        `Update “${name}” to the latest cloud revision?\n\n` +
          'Existing markup, snag pins and calibration stay attached to this drawing. ' +
          "If the new revision's layout differs, pins may no longer line up and should be re-checked.",
      )
    ) {
      return
    }
    startTransition(async () => {
      try {
        await updateFloorPlanToLatestAction(planId, projectId)
        router.refresh()
      } catch (e) {
        alert(`Update failed: ${e instanceof Error ? e.message : 'unknown'}`)
      }
    })
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={`Update ${name} to latest version`}
      title="Adopt the latest cloud revision as the active drawing"
      style={{
        ...actionButtonStyle,
        color: 'var(--c-amber)',
        borderColor: 'var(--c-amber)',
        cursor: pending ? 'progress' : 'pointer',
      }}
    >
      {pending ? '…' : 'Update'}
    </button>
  )
}
