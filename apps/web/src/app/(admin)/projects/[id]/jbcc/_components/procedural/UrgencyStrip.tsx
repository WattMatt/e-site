import Link from 'next/link'

interface UrgencyItem {
  code: string
  title: string
  dueLabel: string   // e.g. "3 WD overdue" or "4 WD remaining"
}

interface UrgencyStripProps {
  overdue: number
  dueSoon: number
  items: UrgencyItem[]
  trackingHref: string
}

/**
 * The urgency hero strip — red gradient, serif italic headline, mono notice list.
 * Matches .urgency from the Procedural mockup.
 * Only rendered when overdue > 0 || dueSoon > 0.
 */
export function UrgencyStrip({ overdue, dueSoon, items, trackingHref }: UrgencyStripProps) {
  if (overdue === 0 && dueSoon === 0) return null

  const headlineParts: string[] = []
  if (overdue > 0) headlineParts.push(`${overdue === 1 ? 'One' : overdue} overdue`)
  if (dueSoon > 0) headlineParts.push(`${dueSoon === 1 ? 'One' : dueSoon} due soon`)

  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: '6px 1fr auto',
        gap: '0 28px',
        background: 'linear-gradient(90deg, var(--c-red-dim-rgb, rgba(255,107,107,.10)), transparent 60%)',
        border: '1px solid var(--c-red)',
        borderLeft: 'none',
        padding: '24px 28px',
        marginBottom: 64,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Left red bar */}
      <div
        style={{
          background: 'var(--c-red-bright)',
          marginLeft: -28,
        }}
      />

      {/* Content */}
      <div>
        <div
          style={{
            fontFamily: 'var(--f-mono-display)',
            fontSize: 10,
            letterSpacing: '0.22em',
            color: 'var(--c-red-bright)',
            textTransform: 'uppercase',
            marginBottom: 10,
            fontWeight: 500,
          }}
        >
          Action Required
        </div>
        <h2
          style={{
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            fontSize: 22,
            fontWeight: 350,
            letterSpacing: '-0.015em',
            lineHeight: 1.2,
            marginBottom: 12,
            margin: '0 0 12px',
            color: 'var(--c-text)',
          }}
        >
          {headlineParts.join(' · ')}
        </h2>
        <ul
          style={{
            listStyle: 'none',
            display: 'grid',
            gap: 6,
            fontSize: 13,
            color: 'var(--c-text-muted)',
            margin: 0,
            padding: 0,
          }}
        >
          {items.map(item => (
            <li
              key={item.code}
              style={{
                display: 'grid',
                gridTemplateColumns: '50px 1fr auto',
                gap: 18,
                alignItems: 'baseline',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--f-mono-display)',
                  color: 'var(--c-text)',
                  fontSize: 12,
                  letterSpacing: '0.04em',
                }}
              >
                {item.code}
              </span>
              <span>{item.title}</span>
              <span
                style={{
                  fontFamily: 'var(--f-mono-display)',
                  fontSize: 12,
                  color: 'var(--c-red-bright)',
                  letterSpacing: '0.04em',
                }}
              >
                {item.dueLabel}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* CTA */}
      <Link
        href={trackingHref}
        style={{
          fontFamily: 'var(--f-mono-display)',
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--c-text)',
          alignSelf: 'end',
          padding: '8px 14px',
          border: '1px solid var(--c-border)',
          borderRadius: 1,
          whiteSpace: 'nowrap',
          textDecoration: 'none',
          transition: 'all .2s',
        }}
        className="jbcc-urgency-cta"
      >
        Review Tracking →
      </Link>
    </section>
  )
}
