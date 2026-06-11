import { Badge } from '@/components/ui/Badge'

/**
 * Governance banner shown on every MV protection view (spec §8/§9): the engine
 * is verified-not-validated, so every output is stamped "sandbox — not for
 * issue" until the gated-issue flow (Phase 6) passes. Pure markup — safe in a
 * server component.
 */
export function SandboxNotice() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '10px 14px',
        marginBottom: 16,
        borderRadius: 6,
        background: 'var(--c-amber-dim)',
        border: '1px solid var(--c-amber-mid)',
      }}
    >
      <Badge variant="warning">sandbox — not for issue</Badge>
      <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>
        The MV protection engine is <strong>verified, not yet independently validated</strong>.
        Results (including the IBR/inverter approximation) are for design study only —
        not for issue. You validate every study per SANS 10142-1 / ECSA.
      </span>
    </div>
  )
}
