'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import { listSubOrganisations } from '@/actions/sub-organisations.actions'
import { listSubOrgMembers, type SubOrgMember } from '@/actions/sub-org-members.actions'
import {
  addProjectMembersFromSubOrg,
  type AddFromSubOrgStatus,
  type AddFromSubOrgResult,
} from '@/actions/project-members-from-sub-org.actions'
import type { SubOrganisation } from '@esite/shared'

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_MEMBER_ROLES = [
  'project_manager',
  'contractor',
  'inspector',
  'supplier',
  'client_viewer',
] as const
type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number]

const ROLE_LABEL: Record<ProjectMemberRole, string> = {
  project_manager: 'Project Manager',
  contractor:      'Contractor',
  inspector:       'Inspector',
  supplier:        'Supplier',
  client_viewer:   'Client (read-only)',
}

const STATUS_LABEL: Record<AddFromSubOrgStatus, string> = {
  'added':                      'Added',
  'skipped-already-on-project': 'Skipped (already on project)',
  'failed':                     'Failed',
}

const STATUS_COLOR: Record<AddFromSubOrgStatus, string> = {
  'added':                      'var(--c-green)',
  'skipped-already-on-project': 'var(--c-text-dim)',
  'failed':                     'var(--c-danger)',
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  open: boolean
  onClose: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AddFromSubOrgModal({ projectId, open, onClose }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Step 1: sub-org list
  const [subOrgs, setSubOrgs] = useState<SubOrganisation[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Step 2: roster + selection
  const [selectedSubOrg, setSelectedSubOrg] = useState<SubOrganisation | null>(null)
  const [roster, setRoster] = useState<SubOrgMember[] | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [role, setRole] = useState<ProjectMemberRole>('contractor')

  // Submit result
  const [result, setResult] = useState<AddFromSubOrgResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  if (!open) return null

  // ── Load sub-orgs on first render of modal ──
  if (subOrgs === null && !isPending && !loadError) {
    startTransition(async () => {
      const r = await listSubOrganisations()
      if (!r.ok) { setLoadError(r.error); return }
      setSubOrgs(r.subOrganisations)
    })
  }

  function reset() {
    setSubOrgs(null)
    setLoadError(null)
    setSelectedSubOrg(null)
    setRoster(null)
    setSelectedIds(new Set())
    setRole('contractor')
    setResult(null)
    setSubmitError(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  // ── Step 1 → Step 2: pick a sub-org ──
  function handlePickSubOrg(subOrg: SubOrganisation) {
    setSelectedSubOrg(subOrg)
    setRoster(null)
    setSelectedIds(new Set())
    setSubmitError(null)
    startTransition(async () => {
      const r = await listSubOrgMembers(subOrg.id)
      if (!r.ok) { setLoadError(r.error); return }
      setRoster(r.members)
    })
  }

  // ── Step 2: checkbox toggle ──
  function toggleUser(userId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  function toggleAll() {
    if (!roster) return
    if (selectedIds.size === roster.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(roster.map((m) => m.user_id)))
    }
  }

  // ── Submit ──
  function handleSubmit() {
    if (!selectedSubOrg || selectedIds.size === 0) return
    setSubmitError(null)
    startTransition(async () => {
      const r = await addProjectMembersFromSubOrg({
        projectId,
        subOrgId:    selectedSubOrg.id,
        userIds:     Array.from(selectedIds),
        projectRole: role,
      })
      if (!r.ok) { setSubmitError(r.error); return }
      setResult(r)
      router.refresh()
    })
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sub-org-modal-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div
        style={{
          width: 'min(560px, 95vw)', maxHeight: '90vh', overflow: 'auto',
          background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 8,
          boxShadow: '0 14px 40px rgba(0,0,0,0.55)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--c-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2
            id="sub-org-modal-title"
            style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', margin: 0 }}
          >
            {result
              ? 'Done'
              : selectedSubOrg
                ? `Add from ${selectedSubOrg.name}`
                : 'Add from sub-organisation'}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', color: 'var(--c-text-dim)',
              fontSize: 18, cursor: 'pointer', padding: 4,
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 18 }}>
          {result ? (
            <Summary
              result={result}
              roster={roster ?? []}
              onDone={handleClose}
            />
          ) : selectedSubOrg ? (
            <Step2
              subOrg={selectedSubOrg}
              roster={roster}
              selectedIds={selectedIds}
              role={role}
              isPending={isPending}
              error={submitError}
              onBack={() => { setSelectedSubOrg(null); setRoster(null); setSelectedIds(new Set()) }}
              onToggleUser={toggleUser}
              onToggleAll={toggleAll}
              onRoleChange={setRole}
              onSubmit={handleSubmit}
              onCancel={handleClose}
            />
          ) : (
            <Step1
              subOrgs={subOrgs}
              isPending={isPending}
              error={loadError}
              onPick={handlePickSubOrg}
              onCancel={handleClose}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Step 1: Sub-org picker ───────────────────────────────────────────────────

function Step1({
  subOrgs,
  isPending,
  error,
  onPick,
  onCancel,
}: {
  subOrgs: SubOrganisation[] | null
  isPending: boolean
  error: string | null
  onPick: (s: SubOrganisation) => void
  onCancel: () => void
}) {
  if (error) {
    return (
      <div>
        <p style={{ fontSize: 12, color: 'var(--c-danger)', marginBottom: 12 }}>{error}</p>
        <Button size="sm" variant="ghost" onClick={onCancel}>Close</Button>
      </div>
    )
  }

  if (isPending || subOrgs === null) {
    return (
      <p style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>Loading sub-organisations…</p>
    )
  }

  // Only show active, unclaimed (shadow) sub-orgs. Deactivated or claimed orgs
  // are blocked server-side by addProjectMembersFromSubOrg; hiding them here
  // avoids the user picking an option that will immediately fail.
  const pickable = subOrgs.filter((s) => s.is_active && s.is_shadow)

  if (pickable.length === 0) {
    return (
      <div>
        <p style={{ fontSize: 13, color: 'var(--c-text-mid)', marginBottom: 16 }}>
          No sub-organisations found. Create one in{' '}
          <a href="/settings/sub-organizations" style={{ color: 'var(--c-amber)', textDecoration: 'none' }}>
            Settings → Sub-organisations
          </a>{' '}
          first.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" onClick={onCancel}>Close</Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginBottom: 12 }}>
        Select a sub-organisation to add members from its roster to this project.
        {pickable.length} sub-organisation{pickable.length !== 1 ? 's' : ''} available.
      </p>
      <div style={{
        border: '1px solid var(--c-border)', borderRadius: 4,
        overflow: 'hidden', marginBottom: 16,
      }}>
        {pickable.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '10px 14px', textAlign: 'left',
              background: 'transparent', border: 'none',
              borderTop: i === 0 ? 'none' : '1px solid var(--c-border)',
              cursor: 'pointer', color: 'var(--c-text)', fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 600 }}>{s.name}</span>
            <span style={{ fontSize: 11, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>
              {s.is_shadow ? 'Shadow' : 'Claimed'} →
            </span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// ─── Step 2: Roster selector ──────────────────────────────────────────────────

function Step2({
  subOrg,
  roster,
  selectedIds,
  role,
  isPending,
  error,
  onBack,
  onToggleUser,
  onToggleAll,
  onRoleChange,
  onSubmit,
  onCancel,
}: {
  subOrg: SubOrganisation
  roster: SubOrgMember[] | null
  selectedIds: Set<string>
  role: string
  isPending: boolean
  error: string | null
  onBack: () => void
  onToggleUser: (id: string) => void
  onToggleAll: () => void
  onRoleChange: (r: typeof PROJECT_MEMBER_ROLES[number]) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const allSelected = roster != null && roster.length > 0 && selectedIds.size === roster.length

  return (
    <div>
      {/* Back link */}
      <button
        type="button"
        onClick={onBack}
        style={{
          background: 'transparent', border: 'none', padding: 0,
          color: 'var(--c-text-dim)', fontSize: 12, cursor: 'pointer',
          marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        ← Back to sub-organisations
      </button>

      {roster === null ? (
        <p style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>Loading roster…</p>
      ) : roster.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--c-text-mid)', marginBottom: 16 }}>
          {subOrg.name} has no active roster members yet.
        </p>
      ) : (
        <>
          {/* Roster checklist */}
          <div style={{ marginBottom: 14 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 6,
            }}>
              <label style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-dim)',
              }}>
                Select members ({selectedIds.size} of {roster.length})
              </label>
              <button
                type="button"
                onClick={onToggleAll}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 11, color: 'var(--c-amber)', padding: 0,
                }}
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div style={{
              border: '1px solid var(--c-border)', borderRadius: 4,
              maxHeight: 220, overflow: 'auto',
            }}>
              {roster.map((m, i) => (
                <label
                  key={m.user_id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', cursor: 'pointer',
                    borderTop: i === 0 ? 'none' : '1px solid var(--c-border)',
                    background: selectedIds.has(m.user_id) ? 'var(--c-elevated)' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(m.user_id)}
                    onChange={() => onToggleUser(m.user_id)}
                    style={{ flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                      {m.full_name ?? <span style={{ color: 'var(--c-text-dim)' }}>—</span>}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 1 }}>
                      {m.email ?? '—'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Role selector */}
          <div style={{ marginBottom: 14 }}>
            <label
              htmlFor="sub-org-role"
              style={{
                display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10,
                fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                color: 'var(--c-text-dim)', marginBottom: 4,
              }}
            >
              Project role
            </label>
            <select
              id="sub-org-role"
              value={role}
              onChange={(e) => onRoleChange(e.target.value as typeof PROJECT_MEMBER_ROLES[number])}
              disabled={isPending}
              style={{
                width: '100%', padding: '8px 10px', fontSize: 13,
                border: '1px solid var(--c-border)', borderRadius: 4,
                background: 'var(--c-input-bg)', color: 'var(--c-text)',
              }}
            >
              {PROJECT_MEMBER_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </div>

          {/* Scope + cross-org clarity note */}
          <div style={{
            padding: '10px 12px', marginBottom: 14, fontSize: 12, lineHeight: 1.55,
            color: 'var(--c-text-mid)', background: 'var(--c-elevated)',
            border: '1px solid var(--c-border)', borderRadius: 4,
          }}>
            The people you select from <strong>{subOrg.name}</strong> will get access to
            {' '}<strong>this site only</strong> — it’s added to their own Projects list. They keep
            access to {subOrg.name}’s own work and won’t see the rest of your organisation.
            Each person is emailed to say who added them and to which site.
          </div>
        </>
      )}

      {error && (
        <div style={{
          padding: '8px 12px', fontSize: 12, color: 'var(--c-danger)',
          background: 'var(--c-danger-dim)', border: '1px solid var(--c-danger)',
          borderRadius: 4, marginBottom: 14,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={isPending || selectedIds.size === 0}
          isLoading={isPending}
        >
          Add {selectedIds.size > 0 ? `${selectedIds.size} member${selectedIds.size !== 1 ? 's' : ''}` : 'members'}
        </Button>
      </div>
    </div>
  )
}

// ─── Summary screen ───────────────────────────────────────────────────────────

function Summary({
  result,
  roster,
  onDone,
}: {
  result: AddFromSubOrgResult
  roster: SubOrgMember[]
  onDone: () => void
}) {
  const { summary, details } = result
  // Build a quick lookup from user_id → email for display.
  const emailByUserId = new Map(roster.map((m) => [m.user_id, m.email ?? m.user_id]))

  return (
    <div>
      {/* Stat cards */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8, marginBottom: 16,
      }}>
        {[
          ['Added',   summary.added],
          ['Skipped', summary.skipped],
          ['Failed',  summary.failed],
        ].map(([label, n]) => (
          <div
            key={String(label)}
            style={{
              padding: '10px 12px', background: 'var(--c-elevated)',
              border: '1px solid var(--c-border)', borderRadius: 4,
              textAlign: 'center',
            }}
          >
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--c-text-dim)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              {label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text)', marginTop: 2 }}>
              {n as number}
            </div>
          </div>
        ))}
      </div>

      {/* Per-row outcomes */}
      <div style={{
        maxHeight: 240, overflow: 'auto',
        border: '1px solid var(--c-border)', borderRadius: 4,
        marginBottom: 16,
      }}>
        {details.map((d, i) => (
          <div
            key={`${d.user_id}-${i}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px',
              borderTop: i === 0 ? 'none' : '1px solid var(--c-border)',
              fontSize: 12,
            }}
          >
            <span style={{ flex: 1, fontFamily: 'var(--font-mono)', color: 'var(--c-text)' }}>
              {emailByUserId.get(d.user_id) ?? d.user_id}
            </span>
            <span style={{ color: STATUS_COLOR[d.status], fontWeight: 600, fontSize: 11 }}>
              {STATUS_LABEL[d.status]}
            </span>
            {d.reason && (
              <span style={{ color: 'var(--c-text-dim)', fontSize: 10, maxWidth: 180, textAlign: 'right' }}>
                {d.reason}
              </span>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}
