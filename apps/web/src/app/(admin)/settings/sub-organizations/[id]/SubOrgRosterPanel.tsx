'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import {
  addSubOrgMember,
  removeSubOrgMember,
  type SubOrgMember,
} from '@/actions/sub-org-members.actions'

const ROLE_BADGE: Record<string, string> = {
  owner:           'badge badge-amber',
  admin:           'badge badge-amber',
  project_manager: 'badge badge-blue',
  contractor:      'badge badge-muted',
  inspector:       'badge badge-muted',
  supplier:        'badge badge-muted',
  client_viewer:   'badge badge-muted',
}

const SUB_ORG_ROLES = [
  'contractor',
  'inspector',
  'supplier',
  'project_manager',
  'client_viewer',
] as const

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  border: '1px solid var(--c-border)',
  borderRadius: 4,
  background: 'var(--c-input-bg)',
  color: 'var(--c-text)',
}

interface Props {
  subOrgId: string
  initialMembers: SubOrgMember[]
  onOpenBulkInvite: () => void
}

export function SubOrgRosterPanel({ subOrgId, initialMembers, onOpenBulkInvite }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [showForm, setShowForm] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('contractor')
  const [formError, setFormError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const activeCount = initialMembers.length

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function resetForm() {
    setFullName('')
    setEmail('')
    setRole('contractor')
    setFormError(null)
  }

  function handleCancelForm() {
    resetForm()
    setShowForm(false)
  }

  function handleSave() {
    setFormError(null)
    if (!fullName.trim()) { setFormError('Full name is required.'); return }
    if (!email.trim())    { setFormError('Email is required.'); return }

    startTransition(async () => {
      const result = await addSubOrgMember(subOrgId, {
        email:    email.trim().toLowerCase(),
        fullName: fullName.trim(),
        role,
      })
      if (!result.ok) {
        setFormError(result.error)
        return
      }
      resetForm()
      setShowForm(false)
      showToast('Member added.')
      router.refresh()
    })
  }

  function handleRemove(member: SubOrgMember) {
    const displayName = member.full_name ?? member.email ?? 'this person'
    if (!confirm(`Remove ${displayName} from the roster?`)) return
    startTransition(async () => {
      const result = await removeSubOrgMember(member.id)
      if (!result.ok) {
        alert(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div style={{ padding: '16px 18px' }}>
      {/* Header strip */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
          {activeCount} active
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowForm((v) => !v)}
            disabled={isPending}
          >
            + Add person
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenBulkInvite}
            disabled={isPending}
          >
            + Bulk invite
          </Button>
        </div>
      </div>

      {/* Success toast */}
      {toast && (
        <div style={{
          padding: '8px 12px', marginBottom: 12, fontSize: 12,
          color: 'var(--c-green)', background: 'var(--c-green-dim)',
          border: '1px solid var(--c-green)', borderRadius: 4,
        }}>
          {toast}
        </div>
      )}

      {/* Inline add form */}
      {showForm && (
        <div style={{
          padding: 14, marginBottom: 14,
          border: '1px solid var(--c-border)', borderRadius: 6,
          background: 'var(--c-elevated)',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={labelStyle}>Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={isPending}
                placeholder="Jane Smith"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isPending}
                placeholder="jane@example.com"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={isPending}
                style={{ ...inputStyle }}
              >
                {SUB_ORG_ROLES.map((r) => (
                  <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
          </div>

          {formError && (
            <div style={{
              padding: '8px 12px', marginBottom: 10, fontSize: 12,
              color: 'var(--c-danger)', background: 'var(--c-danger-dim)',
              border: '1px solid var(--c-danger)', borderRadius: 4,
            }}>
              {formError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" onClick={handleCancelForm} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} isLoading={isPending} disabled={isPending}>
              Save
            </Button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {activeCount === 0 && !showForm && (
        <div style={{
          padding: '24px 18px', textAlign: 'center',
          color: 'var(--c-text-dim)', fontSize: 13,
          border: '1px dashed var(--c-border)', borderRadius: 6,
        }}>
          No one in the roster yet. Click + Add person above to invite the first.
        </div>
      )}

      {/* Member rows */}
      {initialMembers.map((member) => (
        <div
          key={member.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 0',
            borderTop: '1px solid var(--c-border)',
            flexWrap: 'wrap',
          }}
        >
          {/* Avatar */}
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--c-elevated)',
            border: '1px solid var(--c-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 12,
            color: 'var(--c-text-mid)',
            flexShrink: 0,
          }}>
            {(member.full_name ?? member.email ?? '?')[0].toUpperCase()}
          </div>

          {/* Name + email */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, color: 'var(--c-text)', fontWeight: 500, margin: 0 }}>
              {member.full_name ?? '(no name)'}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', margin: 0 }}>
              {member.email ?? '—'}
            </p>
          </div>

          {/* Role badge */}
          <span className={ROLE_BADGE[member.role] ?? 'badge badge-muted'}>
            {member.role.replace(/_/g, ' ')}
          </span>

          {/* Remove button */}
          <Button
            variant="danger"
            size="sm"
            onClick={() => handleRemove(member)}
            disabled={isPending}
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  )
}
