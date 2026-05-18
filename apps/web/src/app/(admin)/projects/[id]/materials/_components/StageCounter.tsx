import type { Stage } from '@esite/shared'

type Props = {
  stage: Stage
  label: string
  description: string
  count: number
  recent: Array<{ id: string; label: string }>
}

export function StageCounter({ label, description, count, recent }: Props) {
  return (
    <article className="data-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', height: '100%' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h3 className="data-panel-title" style={{ margin: 0 }}>
          {label}
        </h3>
        <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--c-amber)' }}>{count}</span>
      </header>
      <p style={{ fontSize: '0.875rem', color: 'var(--c-text-dim)', margin: 0 }}>{description}</p>
      {recent.length > 0 && (
        <ul style={{ marginTop: 'auto', paddingTop: '0.5rem', borderTop: '1px solid var(--c-border)', listStyle: 'none', padding: '0.5rem 0 0', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {recent.map((r) => (
            <li key={r.id} style={{ fontSize: '0.75rem', color: 'var(--c-text-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.label}
            </li>
          ))}
        </ul>
      )}
      {count === 0 && (
        <p className="data-panel-empty" style={{ marginTop: 'auto', fontSize: '0.75rem', fontStyle: 'italic' }}>
          Nothing in this stage yet.
        </p>
      )}
    </article>
  )
}
