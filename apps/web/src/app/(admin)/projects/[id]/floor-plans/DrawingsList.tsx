'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

export type DrawingListItem = {
  id: string
  name: string
  level: string | null
  scale: string | null
  file_size_bytes: number | null
  previewUrl: string | null
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
    if (!q) return plans
    return plans.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.level ?? '').toLowerCase().includes(q),
    )
  }, [plans, query])

  const grouped = useMemo(() => {
    const map = new Map<string, DrawingListItem[]>()
    for (const p of filtered) {
      const k = p.level?.trim() || 'Unspecified'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(p)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or level…"
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
                {mode === 'list' ? 'List' : 'By level'}
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
      {plans.map((plan) => (
        <Card key={plan.id} plan={plan} projectId={projectId} />
      ))}
    </div>
  )
}

function Card({ plan, projectId }: { plan: DrawingListItem; projectId: string }) {
  return (
    <Link
      href={`/projects/${projectId}/floor-plans/${plan.id}`}
      className="data-panel"
      style={{
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        display: 'block',
      }}
    >
      <div
        style={{
          height: 160,
          background: 'var(--c-base)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid var(--c-border)',
          overflow: 'hidden',
        }}
      >
        {plan.previewUrl ? (
          <img
            src={plan.previewUrl}
            alt={plan.name}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <span style={{ fontSize: 40 }} aria-hidden="true">📄</span>
        )}
      </div>
      <div style={{ padding: '12px 14px' }}>
        <p
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
        </p>
        {plan.level && (
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--c-text-dim)',
              marginTop: 2,
              letterSpacing: '0.04em',
            }}
          >
            {plan.level}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
          {plan.scale && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
              Scale: {plan.scale}
            </span>
          )}
          {plan.file_size_bytes && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
              {formatBytes(plan.file_size_bytes)}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
