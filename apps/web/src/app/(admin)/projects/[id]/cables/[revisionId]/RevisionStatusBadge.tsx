/**
 * Surfaces the revision's DRAFT / ISSUED / SUPERSEDED status as a small
 * inline badge next to the page title. Shipped 2026-05-18 (#4 of the top-5
 * end-of-day list) — was the cause of yesterday's 4-iteration "are the
 * cells locked?" debug cycle. Now it's obvious at a glance.
 *
 * Server-component-friendly (pure markup, no state).
 */

interface Props {
  status: string
  /** Optional descriptive suffix shown next to the tag, e.g. "(read-only)". */
  hint?: string
}

export function RevisionStatusBadge({ status, hint }: Props) {
  const normalised = String(status).toUpperCase() as 'DRAFT' | 'ISSUED' | 'SUPERSEDED' | string
  const tone: { bg: string; fg: string; border: string; icon: string } =
    normalised === 'DRAFT'
      ? { bg: 'var(--c-amber-dim)', fg: 'var(--c-amber)', border: 'var(--c-amber-mid)', icon: '✎' }
      : normalised === 'ISSUED'
        ? { bg: 'var(--c-green-dim)', fg: 'var(--c-green)', border: 'var(--c-green)', icon: '🔒' }
        : normalised === 'SUPERSEDED'
          ? { bg: 'var(--c-base)', fg: 'var(--c-text-dim)', border: 'var(--c-border)', icon: '⊘' }
          : { bg: 'var(--c-base)', fg: 'var(--c-text-mid)', border: 'var(--c-border)', icon: '?' }

  const defaultHint = normalised === 'DRAFT'
    ? '(editable)'
    : normalised === 'ISSUED'
      ? '(read-only — snapshot locked)'
      : normalised === 'SUPERSEDED'
        ? '(read-only — superseded by newer revision)'
        : ''

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginLeft: 10,
        padding: '3px 8px',
        borderRadius: 4,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontWeight: 600,
        color: tone.fg,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        verticalAlign: 'middle',
      }}
      title={hint ?? defaultHint}
      aria-label={`Revision status: ${normalised}${(hint ?? defaultHint) ? ` ${hint ?? defaultHint}` : ''}`}
    >
      <span aria-hidden="true">{tone.icon}</span>
      {normalised}
    </span>
  )
}
