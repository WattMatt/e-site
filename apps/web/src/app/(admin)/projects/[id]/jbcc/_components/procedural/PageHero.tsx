import type { ReactNode } from 'react'

interface PageHeroProps {
  eyebrow: string
  title: ReactNode
  meta?: Array<{ label: string; value: ReactNode }>
}

/**
 * Eyebrow + Fraunces italic page title + mono meta line.
 * Matches the .page-eyebrow / .page-title / .page-meta pattern from the Procedural mockup.
 */
export function PageHero({ eyebrow, title, meta }: PageHeroProps) {
  return (
    <div>
      {/* Eyebrow — amber mono caps with trailing gradient line */}
      <div
        style={{
          fontFamily: 'var(--f-mono-display)',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.24em',
          color: 'var(--c-amber)',
          textTransform: 'uppercase',
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {eyebrow}
        <span
          style={{
            height: 1,
            flex: 1,
            background: 'linear-gradient(90deg, var(--c-amber-mid-rgb, rgba(232,146,58,.32)), transparent)',
            maxWidth: 120,
          }}
        />
      </div>

      {/* Fraunces italic display title */}
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontWeight: 350,
          fontSize: 'clamp(40px, 5.5vw, 72px)',
          lineHeight: 0.95,
          letterSpacing: '-0.025em',
          color: 'var(--c-text)',
          fontVariationSettings: "'opsz' 144, 'SOFT' 30",
          marginBottom: 24,
          margin: '0 0 24px',
        }}
      >
        {title}
      </h1>

      {/* Meta line — mono, muted, border-top separator */}
      {meta && meta.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 32,
            fontFamily: 'var(--f-mono-display)',
            fontSize: 11,
            color: 'var(--c-text-muted)',
            letterSpacing: '0.06em',
            borderTop: '1px solid var(--c-border)',
            paddingTop: 16,
            marginBottom: 56,
            flexWrap: 'wrap',
          }}
        >
          {meta.map(({ label, value }) => (
            <span key={label}>
              {value}{' '}
              <strong style={{ color: 'var(--c-text)', fontWeight: 500 }}>{label}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
