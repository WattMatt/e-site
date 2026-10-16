/**
 * Small presentational pieces shared by the tariff explorer pages: headline
 * tiles, the year-on-year chip, chip links and the date format. No state, so
 * server and client components can both use them.
 */
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { signedPct, type YoyCell } from '@esite/shared'

export const MUTED: CSSProperties = { color: 'var(--c-text-mid)' }
export const NUM: CSSProperties = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
/** Tiles and cards wrap to as many columns as fit, so nothing overflows a phone. */
export const autoGrid = (min: number, gap = 12): CSSProperties => ({ display: 'grid', gap, gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))` })

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-04-01" -> "1 Apr 2026". Anything else is shown as stored. */
export function formatIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 11, ...MUTED, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, ...MUTED, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const chip = (bg: string, fg: string): CSSProperties => ({
  display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: bg, color: fg, ...NUM,
})

/**
 * A price change: dearer is red, cheaper green, unchanged muted. `credit`
 * flips the colours for money paid TO the customer (an export credit), where a
 * rise is good news. `vs` names the comparison year for screen readers too.
 */
export function YoyChip({ pct, vs, credit = false }: { pct: number; vs?: string; credit?: boolean }) {
  const r = Math.round(pct * 10) / 10
  const good = credit ? r > 0 : r < 0
  const bad = credit ? r < 0 : r > 0
  const style = bad ? chip('var(--c-red-dim)', 'var(--c-red)') : good ? chip('var(--c-green-dim)', 'var(--c-green)') : chip('var(--c-elevated)', 'var(--c-text-mid)')
  return (
    <span style={style} title={vs} data-tone={bad ? 'worse' : good ? 'better' : 'same'}>
      <span aria-hidden>{r > 0 ? '▲ ' : r < 0 ? '▼ ' : ''}</span>{signedPct(pct)}{vs && <span className="sr-only"> {vs}</span>}
    </span>
  )
}

/** One charge's change against last year; nothing at all when there is no last year. */
export function YoyCellChip({ y, previousFy, credit = false }: { y: YoyCell; previousFy: string | null; credit?: boolean }) {
  const vs = previousFy ? `vs ${previousFy}` : undefined
  switch (y.kind) {
    case 'changed': return <YoyChip pct={y.pct} vs={vs} credit={credit} />
    case 'new': return <span style={chip('var(--c-blue-dim)', 'var(--c-blue)')} title={vs}>New{vs && <span className="sr-only"> {vs}</span>}</span>
    case 'unit_changed': return <span style={chip('var(--c-amber-dim)', 'var(--c-amber)')} title={vs}>Unit changed{vs && <span className="sr-only"> {vs}</span>}</span>
    case 'no_previous': return null
  }
}

export function ChipLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} style={{
      padding: '5px 12px', borderRadius: 999, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap',
      border: `1px solid ${active ? 'var(--c-amber)' : 'var(--c-border)'}`,
      background: active ? 'var(--c-amber-dim)' : 'transparent', color: active ? 'var(--c-amber)' : 'var(--c-text)',
    }}>{children}</Link>
  )
}

export function Breadcrumb({ items }: { items: Array<{ href?: string; label: string }> }) {
  return (
    <nav aria-label="Breadcrumb" style={{ fontSize: 13, ...MUTED, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((it, i) => (
        <span key={i} style={{ display: 'inline-flex', gap: 6 }}>
          {i > 0 && <span aria-hidden>›</span>}
          {it.href ? <Link href={it.href} style={{ color: 'var(--c-text-mid)' }}>{it.label}</Link> : <span style={{ color: 'var(--c-text)' }}>{it.label}</span>}
        </span>
      ))}
    </nav>
  )
}
