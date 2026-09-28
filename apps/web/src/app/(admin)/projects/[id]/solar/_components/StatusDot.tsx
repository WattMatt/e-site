import type { ReadinessStatus } from '@esite/shared'

const COLOURS: Record<ReadinessStatus, string> = {
  grey: 'var(--c-text-dim)',
  amber: 'var(--c-amber)',
  green: 'var(--c-green)',
  red: 'var(--c-red)',
}
const WORDS: Record<ReadinessStatus, string> = {
  grey: 'Not started',
  amber: 'Incomplete',
  green: 'Complete',
  red: 'Blocking',
}

/** Readiness dot (spec §0.3): tooltip = the exact rule outcome. */
export function StatusDot({ status, reason }: { status: ReadinessStatus; reason: string }) {
  return (
    <span
      role="img"
      aria-label={`${WORDS[status]}: ${reason}`}
      title={reason}
      style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: COLOURS[status], marginRight: 6, flexShrink: 0 }}
    />
  )
}
