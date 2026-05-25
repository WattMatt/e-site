interface SectionHeaderProps {
  num: string      // e.g. "§ 04"
  title: string    // e.g. "Changes, Delays & Site Conditions"
  count?: string   // e.g. "06 notices"
}

/**
 * Section divider: amber mono number · Fraunces italic title · right-aligned mono count.
 * Matches .section-h from the Procedural mockup.
 */
export function SectionHeader({ num, title, count }: SectionHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 16,
        margin: '0 0 28px',
        paddingBottom: 16,
        borderBottom: '1px solid var(--c-border)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--f-mono-display)',
          fontSize: 10,
          letterSpacing: '0.22em',
          color: 'var(--c-amber)',
          textTransform: 'uppercase',
        }}
      >
        {num}
      </span>
      <span
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontWeight: 350,
          fontSize: 26,
          lineHeight: 1,
          letterSpacing: '-0.015em',
          color: 'var(--c-text)',
        }}
      >
        {title}
      </span>
      {count && (
        <span
          style={{
            fontFamily: 'var(--f-mono-display)',
            fontSize: 11,
            color: 'var(--c-text-muted)',
            letterSpacing: '0.06em',
            marginLeft: 'auto',
          }}
        >
          {count}
        </span>
      )}
    </div>
  )
}
