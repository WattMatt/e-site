'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { reassignSeatAction } from '@/actions/seats.actions'
import type { SeatMember } from '@/actions/seats.actions'

const monoDim: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.06em',
}

interface Props {
  members:       SeatMember[]
  totalSeats:    number
  assignedSeats: number
}

export function SeatsPanel({ members, totalSeats, assignedSeats }: Props) {
  const router   = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError]   = useState<string | null>(null)
  const [buying, setBuying] = useState<string | null>(null)  // user_id being purchased

  // Reassign / free a seat.
  async function doReassign(seatId: string, newUserId: string | null) {
    setError(null)
    startTransition(async () => {
      const res = await reassignSeatAction(seatId, newUserId)
      if (!res.ok) {
        setError(res.error)
      } else {
        router.refresh()
      }
    })
  }

  // Buy a seat via Paystack redirect.
  async function doBuy(targetUserId: string) {
    setBuying(targetUserId)
    setError(null)
    try {
      const res = await fetch('/api/paystack/feature-seat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_key: 'generator_cost_recovery', target_user_id: targetUserId }),
      })
      const data = await res.json()
      if (res.status === 409 && data.alreadyUnlocked) {
        router.refresh()
        return
      }
      if (data.authorization_url) {
        window.location.href = data.authorization_url
      } else {
        setError(data.error ?? 'Payment could not be started. Please try again.')
      }
    } catch {
      setError('Failed to contact payment provider.')
    } finally {
      setBuying(null)
    }
  }

  const freeSeats = totalSeats - assignedSeats
  const seatedIds = new Set(members.filter((m) => m.seat).map((m) => m.user_id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Summary banner */}
      <div
        className="data-panel"
        style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}
      >
        <div>
          <p style={monoDim}>SEATS PURCHASED</p>
          <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text)', marginTop: 2 }}>{totalSeats}</p>
        </div>
        <div>
          <p style={monoDim}>ASSIGNED</p>
          <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-amber)', marginTop: 2 }}>{assignedSeats}</p>
        </div>
        <div>
          <p style={monoDim}>AVAILABLE IN POOL</p>
          <p style={{ fontSize: 22, fontWeight: 700, color: freeSeats > 0 ? 'var(--c-green)' : 'var(--c-text-dim)', marginTop: 2 }}>{freeSeats}</p>
        </div>
      </div>

      {/* Error feedback */}
      {error && (
        <p style={{ ...monoDim, color: 'var(--c-red)', fontSize: 12 }}>{error}</p>
      )}

      {/* Member rows */}
      <div className="data-panel">
        <div className="data-panel-header">
          <span className="data-panel-title">Members &amp; Generator Cost Recovery seats</span>
        </div>

        {members.length === 0 ? (
          <div className="data-panel-empty" style={{ padding: '24px 18px' }}>No active members.</div>
        ) : (
          members.map((m) => {
            const seated   = m.seat !== null
            const isBuying = buying === m.user_id

            return (
              <div
                key={m.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 18px', borderTop: '1px solid var(--c-border)',
                  flexWrap: 'wrap',
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-mid)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--c-amber)',
                  flexShrink: 0,
                }}>
                  {m.full_name?.[0]?.toUpperCase() ?? '?'}
                </div>

                {/* Identity */}
                <div style={{ flex: 1, minWidth: 160 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                    {m.full_name ?? '—'}
                  </p>
                  <p style={monoDim}>{m.email ?? '—'}</p>
                </div>

                {/* Role badge */}
                <span className="badge badge-muted" style={{ textTransform: 'capitalize' }}>
                  {m.role.replace(/_/g, ' ')}
                </span>

                {/* Seat status */}
                {seated ? (
                  <span className="badge badge-amber">Seated</span>
                ) : (
                  <span className="badge badge-muted" style={{ color: 'var(--c-text-dim)' }}>No seat</span>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {!seated && (
                    <Button
                      variant="primary"
                      size="sm"
                      isLoading={isBuying}
                      disabled={pending || isBuying}
                      onClick={() => doBuy(m.user_id)}
                    >
                      Buy seat
                    </Button>
                  )}

                  {!seated && freeSeats > 0 && (
                    // Assign a pooled (unassigned) seat to this member.
                    <AssignFromPoolButton
                      members={members}
                      targetUserId={m.user_id}
                      pending={pending}
                      onAssign={doReassign}
                    />
                  )}

                  {seated && m.seat && (
                    <>
                      <ReassignButton
                        seatId={m.seat.id}
                        members={members}
                        seatedIds={seatedIds}
                        pending={pending}
                        onReassign={doReassign}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => doReassign(m.seat!.id, null)}
                        style={{ color: 'var(--c-red)', borderColor: 'var(--c-red)' }}
                      >
                        Free
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Finds the first unassigned seat in the pool and assigns it to the target user.
 */
function AssignFromPoolButton({
  members,
  targetUserId,
  pending,
  onAssign,
}: {
  members:       SeatMember[]
  targetUserId:  string
  pending:       boolean
  onAssign:      (seatId: string, userId: string) => void
}) {
  const freeSeat = members.find((m) => m.seat && !m.seat.assigned_user_id)?.seat
  if (!freeSeat) return null

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() => onAssign(freeSeat.id, targetUserId)}
    >
      Assign
    </Button>
  )
}

/**
 * Reassign a seated member's seat to another unseated member.
 * Renders a small inline select + confirm button.
 */
function ReassignButton({
  seatId,
  members,
  seatedIds,
  pending,
  onReassign,
}: {
  seatId:    string
  members:   SeatMember[]
  seatedIds: Set<string>
  pending:   boolean
  onReassign: (seatId: string, userId: string) => void
}) {
  const [open, setOpen]       = useState(false)
  const [selected, setSelected] = useState('')

  const unseated = members.filter((m) => !seatedIds.has(m.user_id))
  if (unseated.length === 0) return null

  if (!open) {
    return (
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => setOpen(true)}>
        Reassign
      </Button>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--c-panel)',
          color: 'var(--c-text)', border: '1px solid var(--c-border)', borderRadius: 4, padding: '4px 8px',
        }}
      >
        <option value="">Select member…</option>
        {unseated.map((u) => (
          <option key={u.user_id} value={u.user_id}>
            {u.full_name ?? u.email ?? u.user_id}
          </option>
        ))}
      </select>
      <Button
        variant="primary"
        size="sm"
        disabled={!selected || pending}
        onClick={() => { if (selected) onReassign(seatId, selected) }}
      >
        Confirm
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  )
}
