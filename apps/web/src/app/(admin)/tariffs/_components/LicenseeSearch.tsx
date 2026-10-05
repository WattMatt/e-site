'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { LICENSEE_KIND_LABELS, labelOf, searchLicensees, type LicenseeSearchItem } from '@esite/shared'
import { Badge } from '@/components/ui/Badge'
import { TextInput } from '@/components/ui/FormField'

export function LicenseeSearch({ licensees, hrefFor = (id) => `/tariffs/${id}`, onPick }: {
  licensees: LicenseeSearchItem[]
  hrefFor?: (id: string) => string
  /** When given, a hit is a button that calls this instead of a link. */
  onPick?: (l: LicenseeSearchItem) => void
}) {
  const [q, setQ] = useState('')
  const hits = useMemo(() => searchLicensees(q, licensees, 60), [q, licensees])
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
        Supply authority
        <TextInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Municipality, metro, Eskom or a former name" aria-label="Search supply authorities" />
      </label>
      {hits.length === 0
        ? <p style={{ fontSize: 13, margin: 0 }}>No supply authority matches “{q.trim()}”. Try the municipality&apos;s name or a former name.</p>
        : (
          <ul aria-label="Supply authorities" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
            {hits.map((l) => {
              const body = (
                <>
                  <span style={{ fontWeight: 600 }}>{l.name}</span>
                  <span style={{ color: 'var(--c-text-mid)' }}> · {labelOf(LICENSEE_KIND_LABELS, String(l.kind))}{l.province ? ` · ${l.province}` : ''}</span>
                  {l.matchedAlias && <span style={{ color: 'var(--c-text-mid)' }}> · also known as {l.matchedAlias}</span>}
                  <span style={{ marginLeft: 8 }}>
                    {l.liveFy ? <Badge variant="success">{l.liveFy} published</Badge> : <Badge variant="ghost">No published tariffs</Badge>}
                  </span>
                </>
              )
              return (
                <li key={l.id} style={{ fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--c-border)' }}>
                  {onPick
                    ? <button type="button" onClick={() => onPick(l)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left' }}>{body}</button>
                    : <Link href={hrefFor(l.id)} style={{ textDecoration: 'none', color: 'inherit' }}>{body}</Link>}
                </li>
              )
            })}
          </ul>
        )}
    </div>
  )
}
