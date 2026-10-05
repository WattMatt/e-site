'use client'
/**
 * Supply-authority search. Before anything is typed it shows a browse view:
 * Eskom and the metros, then the published library by province, with the
 * authorities that have nothing published yet folded away (`browse`). In the
 * compare picker (`onPick`) the empty state is just the quick picks.
 */
import Link from 'next/link'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { LICENSEE_KIND_LABELS, browseLicensees, displayLicenseeName, labelOf, provinceLabel, searchLicensees, type LicenseeSearchItem } from '@esite/shared'
import { Badge } from '@/components/ui/Badge'
import { TextInput } from '@/components/ui/FormField'
import { MUTED, autoGrid } from './explorer-ui'

export function LicenseeSearch({ licensees, hrefFor = (id) => `/tariffs/${id}`, onPick, browse = false }: {
  licensees: LicenseeSearchItem[]
  hrefFor?: (id: string) => string
  /** When given, a hit is a button that calls this instead of a link. */
  onPick?: (l: LicenseeSearchItem) => void
  /** Show the full browse view while the search box is empty. */
  browse?: boolean
}) {
  const [q, setQ] = useState('')
  const hits = useMemo(() => (q.trim() ? searchLicensees(q, licensees, 60) : []), [q, licensees])
  const view = useMemo(() => browseLicensees(licensees), [licensees])

  const pick = (l: LicenseeSearchItem, body: ReactNode, style: CSSProperties = {}) => onPick
    ? <button type="button" onClick={() => onPick(l)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left', font: 'inherit', width: '100%', ...style }}>{body}</button>
    : <Link href={hrefFor(l.id)} style={{ textDecoration: 'none', color: 'inherit', display: 'block', ...style }}>{body}</Link>
  const status = (l: LicenseeSearchItem) => l.liveFy ? <Badge variant="success">{l.liveFy} published</Badge> : <Badge variant="ghost">No published tariffs</Badge>
  const meta = (l: LicenseeSearchItem) => `${labelOf(LICENSEE_KIND_LABELS, String(l.kind))}${l.province ? ` · ${provinceLabel(l.province)}` : ''}`

  const tile = (l: LicenseeSearchItem) => (
    <li key={l.id} style={{ listStyle: 'none' }}>
      {pick(l, (
        <span style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{displayLicenseeName(l.name)}</span>
          <span style={{ fontSize: 12, ...MUTED }}>{meta(l)}</span>
          <span>{status(l)}</span>
        </span>
      ), { border: '1px solid var(--c-border)', borderRadius: 8, padding: '10px 12px', background: 'var(--c-surface)', height: '100%', boxSizing: 'border-box' })}
    </li>
  )

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 600 }}>
        Supply authority
        <TextInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a municipality, metro, Eskom or a former name"
          aria-label="Search supply authorities" style={{ fontSize: 15, padding: '10px 12px' }} />
      </label>

      {q.trim()
        ? hits.length === 0
          ? <p style={{ fontSize: 13, margin: 0 }}>No supply authority matches “{q.trim()}”. Try the municipality&apos;s name or a former name.</p>
          : (
            <ul aria-label="Supply authorities" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
              {hits.map((l) => (
                <li key={l.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                  {pick(l, (
                    <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px', padding: '9px 2px' }}>
                      <span style={{ flex: '1 1 220px', minWidth: 0 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{displayLicenseeName(l.name)}</span>
                        <span style={{ display: 'block', fontSize: 12, ...MUTED }}>
                          {meta(l)}{l.matchedAlias && <> · also known as {l.matchedAlias}</>}
                        </span>
                      </span>
                      {status(l)}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )
        : (
          <>
            {view.featured.length > 0 && (
              <section aria-label="Eskom and the metros" style={{ display: 'grid', gap: 8 }}>
                <h3 style={{ fontSize: 13, margin: 0, ...MUTED, fontWeight: 600 }}>Eskom and the metros</h3>
                <ul style={{ margin: 0, padding: 0, ...autoGrid(200, 8) }}>{view.featured.map(tile)}</ul>
              </section>
            )}
            {browse && view.provinces.length > 0 && (
              <section aria-label="By province" style={{ display: 'grid', gap: 8 }}>
                <h3 style={{ fontSize: 13, margin: 0, ...MUTED, fontWeight: 600 }}>Municipalities and other distributors, by province</h3>
                <div style={{ ...autoGrid(260, 12), alignItems: 'start' }}>
                  {view.provinces.map((p) => (
                    <section key={p.code ?? 'none'} aria-label={p.label} style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: '10px 12px' }}>
                      <h4 style={{ fontSize: 13, margin: '0 0 6px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{p.label}</span><span style={{ ...MUTED, fontWeight: 400 }}>{p.items.length}</span>
                      </h4>
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
                        {p.items.map((l) => (
                          <li key={l.id} style={{ fontSize: 13 }}>
                            {pick(l, (
                              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
                                <span style={{ minWidth: 0 }}>{displayLicenseeName(l.name)}</span>
                                <span style={{ fontSize: 11, ...MUTED, whiteSpace: 'nowrap' }}>{l.liveFy}</span>
                              </span>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </section>
            )}
            {browse && view.unpublished.length > 0 && (
              <details>
                <summary style={{ fontSize: 13, cursor: 'pointer', ...MUTED }}>
                  {view.unpublished.length} supply authorit{view.unpublished.length === 1 ? 'y has' : 'ies have'} no published tariffs yet
                </summary>
                <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, ...autoGrid(220, 2), fontSize: 13 }}>
                  {view.unpublished.map((l) => (
                    <li key={l.id}>{pick(l, <span style={{ padding: '2px 0', display: 'block' }}>{displayLicenseeName(l.name)} <span style={{ fontSize: 11, ...MUTED }}>· {provinceLabel(l.province)}</span></span>)}</li>
                  ))}
                </ul>
              </details>
            )}
            {!browse && <p style={{ fontSize: 12, margin: 0, ...MUTED }}>Or type to search all {licensees.length} supply authorities with published tariffs.</p>}
          </>
        )}
    </div>
  )
}
