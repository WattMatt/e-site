'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

export type LengthMode = 'design' | 'as-built' | 'worst'

const MODES: Array<{ key: LengthMode; label: string; title: string }> = [
  { key: 'design',   label: 'Design',     title: 'Use measured lengths everywhere — tender / budget basis' },
  { key: 'as-built', label: 'As-built',   title: 'Use confirmed lengths where signed off, measured otherwise — default' },
  { key: 'worst',    label: 'Worst-case', title: 'Use max(measured, confirmed) per cable — engineer compliance buffer' },
]

export function LengthModeToggle({ basePath, current }: { basePath: string; current: LengthMode }) {
  const params = useSearchParams()

  function hrefFor(mode: LengthMode): string {
    const sp = new URLSearchParams(params.toString())
    if (mode === 'as-built') sp.delete('view')
    else sp.set('view', mode)
    const qs = sp.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  return (
    <div
      role="tablist"
      aria-label="Length-source view"
      style={{
        display: 'inline-flex',
        border: '1px solid var(--c-border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {MODES.map((m) => {
        const active = current === m.key
        return (
          <Link
            key={m.key}
            href={hrefFor(m.key)}
            role="tab"
            aria-selected={active}
            title={m.title}
            scroll={false}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '6px 12px',
              textDecoration: 'none',
              color: active ? 'var(--c-amber)' : 'var(--c-text-mid)',
              background: active ? 'var(--c-amber-dim)' : 'var(--c-panel)',
              borderRight: '1px solid var(--c-border)',
            }}
          >
            {m.label}
          </Link>
        )
      })}
    </div>
  )
}
