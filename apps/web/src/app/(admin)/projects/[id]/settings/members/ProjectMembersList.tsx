'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Users } from 'lucide-react'
import Link from 'next/link'

import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  type ProjectMember,
  type OrgMemberOption,
} from '@/actions/project-members.actions'
import { BulkAddMembersModal } from './BulkAddMembersModal'
import { AddFromSubOrgModal } from './AddFromSubOrgModal'

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_MEMBER_ROLES = [
  'project_manager',
  'contractor',
  'inspector',
  'supplier',
  'client_viewer',
] as const

const ROLE_LABEL: Record<string, string> = {
  project_manager: 'Project Manager',
  contractor:      'Contractor',
  inspector:       'Inspector',
  supplier:        'Supplier',
  client_viewer:   'Client (read-only)',
  owner:           'Owner',
  admin:           'Admin',
}

const ROLE_BADGE: Record<string, string> = {
  owner:           'badge badge-amber',
  admin:           'badge badge-blue',
  project_manager: 'badge badge-blue',
  contractor:      'badge badge-muted',
  inspector:       'badge badge-muted',
  supplier:        'badge badge-muted',
  client_viewer:   'badge badge-muted',
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  orgOwnerId: string | null
  initialMembers: ProjectMember[]
  availableOrgMembers: OrgMemberOption[]
  canEdit: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectMembersList({
  projectId,
  orgOwnerId,
  initialMembers,
  availableOrgMembers,
  canEdit,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false)
  const [addUserId, setAddUserId] = useState('')
  const [addRole, setAddRole] = useState<string>('contractor')
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [showFromSubOrgModal, setShowFromSubOrgModal] = useState(false)

  // Edit state: memberId being edited
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<string>('contractor')

  const [serverError, setServerError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  function openEdit(member: ProjectMember) {
    setEditingId(member.id)
    setEditRole(member.role)
    setServerError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setServerError(null)
  }

  function handleSaveEdit(memberId: string) {
    setServerError(null)
    startTransition(async () => {
      const result = await updateProjectMemberRole(memberId, editRole)
      if ('error' in result) {
        setServerError(result.error)
      } else {
        setEditingId(null)
        router.refresh()
      }
    })
  }

  function handleRemove(member: ProjectMember) {
    if (!confirm(`Remove ${member.full_name ?? 'this member'} from the project?`)) return
    setRemovingId(member.id)
    setServerError(null)
    startTransition(async () => {
      const result = await removeProjectMember(member.id)
      setRemovingId(null)
      if ('error' in result) {
        setServerError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  function handleAdd() {
    if (!addUserId) return
    setServerError(null)
    startTransition(async () => {
      const result = await addProjectMember(projectId, addUserId, addRole)
      if ('error' in result) {
        setServerError(result.error)
      } else {
        setShowAddForm(false)
        setAddUserId('')
        setAddRole('contractor')
        router.refresh()
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Info banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '10px 14px',
          background: 'var(--c-elevated)',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          fontSize: 13,
          color: 'var(--c-text-mid)',
        }}
      >
        <Users size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--c-text-dim)' }} />
        <span>
          Members assigned to this project. Add or remove members to control who sees this
          project&apos;s data. To invite new people to your organisation, use the{' '}
          <Link href="/settings/users" style={{ color: 'var(--c-amber)', textDecoration: 'none' }}>
            organisation members page
          </Link>
          .
        </span>
      </div>

      {/* Members card */}
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
                Project members
              </div>
              <div style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 2 }}>
                {initialMembers.length} explicit member{initialMembers.length !== 1 ? 's' : ''}.
                {' '}Org owners, admins and project managers have implicit access.
              </div>
            </div>
            {canEdit && !showAddForm && (
              <div style={{ display: 'flex', gap: 8 }}>
                {availableOrgMembers.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => setShowAddForm(true)}>
                    + Add member
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => setShowBulkModal(true)}>
                  + Add many
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setShowFromSubOrgModal(true)}>
                  + Add from sub-org
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardBody>
          {serverError && (
            <div
              role="alert"
              style={{
                padding: '8px 12px',
                background: 'var(--c-red-dim)',
                border: '1px solid var(--c-red)',
                borderRadius: 6,
                color: 'var(--c-red)',
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {serverError}
            </div>
          )}

          {/* Add form */}
          {showAddForm && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: '12px 0 16px',
                borderBottom: '1px solid var(--c-border)',
                marginBottom: 8,
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
                <div>
                  <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-dim)', display: 'block', marginBottom: 4 }}>
                    Member
                  </label>
                  <select
                    value={addUserId}
                    onChange={(e) => setAddUserId(e.target.value)}
                    style={{ width: '100%', fontSize: 13, padding: '6px 8px', background: 'var(--c-elevated)', border: '1px solid var(--c-border)', borderRadius: 4, color: 'var(--c-text)' }}
                  >
                    <option value="">Select a member…</option>
                    {availableOrgMembers.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name ?? m.email ?? m.user_id}
                        {' '}({ROLE_LABEL[m.org_role] ?? m.org_role})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-dim)', display: 'block', marginBottom: 4 }}>
                    Project role
                  </label>
                  <select
                    value={addRole}
                    onChange={(e) => setAddRole(e.target.value)}
                    style={{ width: '100%', fontSize: 13, padding: '6px 8px', background: 'var(--c-elevated)', border: '1px solid var(--c-border)', borderRadius: 4, color: 'var(--c-text)' }}
                  >
                    {PROJECT_MEMBER_ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleAdd}
                  isLoading={isPending}
                  disabled={isPending || !addUserId}
                >
                  Add to project
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowAddForm(false); setAddUserId(''); setAddRole('contractor') }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {initialMembers.length === 0 && !showAddForm ? (
            <EmptyState
              icon={Users}
              title="No explicit members yet"
              description="Add org members to scope who sees this project's data."
              dense
              action={
                canEdit && availableOrgMembers.length > 0 ? (
                  <Button size="sm" variant="secondary" onClick={() => setShowAddForm(true)}>
                    + Add member
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div>
              {initialMembers.map((member, i) => {
                const isOrgOwner = member.user_id === orgOwnerId
                const hasOrgOverride = member.org_role && member.org_role !== member.role

                return (
                  <div
                    key={member.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 0',
                      borderTop: i === 0 ? undefined : '1px solid var(--c-border)',
                    }}
                  >
                    {/* Avatar */}
                    <div
                      style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: 'var(--c-amber-mid)', border: '1px solid var(--c-amber)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                        color: 'var(--c-amber)', flexShrink: 0,
                      }}
                    >
                      {(member.full_name ?? member.email ?? '?')[0]?.toUpperCase()}
                    </div>

                    {/* Name + email */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                        {member.full_name ?? <span style={{ color: 'var(--c-text-dim)' }}>—</span>}
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 1 }}>
                        {member.email ?? '—'}
                      </div>
                    </div>

                    {/* Role (edit or display) */}
                    {editingId === member.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <select
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value)}
                          style={{ fontSize: 13, padding: '4px 8px', background: 'var(--c-elevated)', border: '1px solid var(--c-border)', borderRadius: 4, color: 'var(--c-text)' }}
                        >
                          {PROJECT_MEMBER_ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                          ))}
                        </select>
                        <Button size="sm" variant="primary" onClick={() => handleSaveEdit(member.id)} isLoading={isPending} disabled={isPending}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                        <div style={{ textAlign: 'right' }}>
                          <span className={ROLE_BADGE[member.role] ?? 'badge badge-muted'}>
                            {ROLE_LABEL[member.role] ?? member.role}
                          </span>
                          {hasOrgOverride && (
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--c-text-dim)', marginTop: 2 }}>
                              org: {ROLE_LABEL[member.org_role!] ?? member.org_role}
                            </div>
                          )}
                        </div>
                        {canEdit && !isOrgOwner && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(member)}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => handleRemove(member)}
                              isLoading={removingId === member.id}
                              disabled={removingId === member.id}
                            >
                              Remove
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <BulkAddMembersModal
        projectId={projectId}
        open={showBulkModal}
        onClose={() => setShowBulkModal(false)}
      />
      <AddFromSubOrgModal
        projectId={projectId}
        open={showFromSubOrgModal}
        onClose={() => setShowFromSubOrgModal(false)}
      />
    </div>
  )
}
