'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText } from 'lucide-react'

import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, TextInput, Textarea } from '@/components/ui/FormField'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  createJbccParty,
  updateJbccParty,
  deleteJbccParty,
  type JbccParty,
} from '@/actions/jbcc-parties.actions'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PartyFormState {
  party_role: string
  name: string
  company: string
  address: string
  email: string
  phone: string
}

const emptyForm = (): PartyFormState => ({
  party_role: '',
  name: '',
  company: '',
  address: '',
  email: '',
  phone: '',
})

// ─── Inline form ─────────────────────────────────────────────────────────────

function PartyForm({
  initial,
  onSave,
  onCancel,
  isPending,
}: {
  initial: PartyFormState
  onSave: (values: PartyFormState) => void
  onCancel: () => void
  isPending: boolean
}) {
  const [values, setValues] = useState<PartyFormState>(initial)
  const [errors, setErrors] = useState<{ party_role?: string; name?: string }>({})

  function set(field: keyof PartyFormState, value: string) {
    setValues(prev => ({ ...prev, [field]: value }))
    if (field === 'party_role' || field === 'name') {
      setErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }

  function handleSave() {
    const newErrors: { party_role?: string; name?: string } = {}
    if (!values.party_role.trim()) newErrors.party_role = 'Role is required'
    if (!values.name.trim()) newErrors.name = 'Name is required'
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }
    onSave(values)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '12px 0',
        borderTop: '1px solid var(--c-border)',
        marginTop: 8,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormField label="Party role" required error={errors.party_role}>
          <TextInput
            value={values.party_role}
            onChange={e => set('party_role', e.target.value)}
            placeholder="e.g. Employer, Contractor, Principal Agent"
            invalid={!!errors.party_role}
          />
        </FormField>
        <FormField label="Name" required error={errors.name}>
          <TextInput
            value={values.name}
            onChange={e => set('name', e.target.value)}
            placeholder="Full name or entity name"
            invalid={!!errors.name}
          />
        </FormField>
        <FormField label="Company">
          <TextInput
            value={values.company}
            onChange={e => set('company', e.target.value)}
            placeholder="Company name"
          />
        </FormField>
        <FormField label="Email">
          <TextInput
            type="email"
            value={values.email}
            onChange={e => set('email', e.target.value)}
            placeholder="contact@example.com"
          />
        </FormField>
        <FormField label="Phone">
          <TextInput
            value={values.phone}
            onChange={e => set('phone', e.target.value)}
            placeholder="+27 82 000 0000"
          />
        </FormField>
      </div>
      <FormField label="Address">
        <Textarea
          value={values.address}
          onChange={e => set('address', e.target.value)}
          placeholder="Street address, suburb, city, postal code"
          rows={3}
        />
      </FormField>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          size="sm"
          variant="primary"
          onClick={handleSave}
          isLoading={isPending}
          disabled={isPending}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ─── Party row ────────────────────────────────────────────────────────────────

function PartyRow({
  party,
  canEdit,
  onEdit,
  onDelete,
  isDeleting,
}: {
  party: JbccParty
  canEdit: boolean
  onEdit: () => void
  onDelete: () => void
  isDeleting: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        padding: '10px 0',
        borderBottom: '1px solid var(--c-border)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--c-amber)',
              background: 'rgba(232,146,58,0.12)',
              padding: '2px 6px',
              borderRadius: 4,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {party.party_role}
          </span>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-text)' }}>
            {party.name}
          </span>
        </div>
        {party.company && (
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{party.company}</span>
        )}
        {(party.email || party.phone) && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--c-text-mid)',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            {[party.email, party.phone].filter(Boolean).join(' · ')}
          </span>
        )}
        {party.address && (
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)', whiteSpace: 'pre-line' }}>
            {party.address}
          </span>
        )}
      </div>
      {canEdit && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 12 }}>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={onDelete}
            isLoading={isDeleting}
            disabled={isDeleting}
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  projectId: string
  initialParties: JbccParty[]
  canEdit: boolean
}

export function JbccPartiesList({ projectId, initialParties, canEdit }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [formMode, setFormMode] = useState<null | 'add' | string>(null)
  const [editValues, setEditValues] = useState<PartyFormState>(emptyForm())
  const [serverError, setServerError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function openAdd() {
    setEditValues(emptyForm())
    setFormMode('add')
    setServerError(null)
  }

  function openEdit(party: JbccParty) {
    setEditValues({
      party_role: party.party_role,
      name: party.name,
      company: party.company ?? '',
      address: party.address ?? '',
      email: party.email ?? '',
      phone: party.phone ?? '',
    })
    setFormMode(party.id)
    setServerError(null)
  }

  function closeForm() {
    setFormMode(null)
    setServerError(null)
  }

  function handleSaveAdd(values: PartyFormState) {
    startTransition(async () => {
      const result = await createJbccParty(projectId, {
        party_role: values.party_role,
        name: values.name,
        company: values.company || null,
        address: values.address || null,
        email: values.email || null,
        phone: values.phone || null,
      })
      if ('error' in result) {
        setServerError(result.error)
      } else {
        setFormMode(null)
        setServerError(null)
        router.refresh()
      }
    })
  }

  function handleSaveEdit(partyId: string, values: PartyFormState) {
    startTransition(async () => {
      const result = await updateJbccParty(partyId, {
        party_role: values.party_role,
        name: values.name,
        company: values.company || null,
        address: values.address || null,
        email: values.email || null,
        phone: values.phone || null,
      })
      if ('error' in result) {
        setServerError(result.error)
      } else {
        setFormMode(null)
        setServerError(null)
        router.refresh()
      }
    })
  }

  function handleDelete(party: JbccParty) {
    if (!confirm(`Delete party '${party.name}' (${party.party_role})?`)) return
    setDeletingId(party.id)
    startTransition(async () => {
      const result = await deleteJbccParty(party.id)
      setDeletingId(null)
      if ('error' in result) {
        setServerError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
              JBCC parties
            </div>
            <div style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 2 }}>
              Parties referenced in JBCC notice generation (employer, contractor, principal agent, etc.).
            </div>
          </div>
          {canEdit && formMode === null && (
            <Button size="sm" variant="secondary" onClick={openAdd}>
              + Add party
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {serverError && (
          <div
            role="alert"
            style={{
              padding: '8px 12px',
              background: 'rgba(232,85,85,0.08)',
              border: '1px solid rgba(232,85,85,0.3)',
              borderRadius: 6,
              color: 'var(--c-red)',
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {serverError}
          </div>
        )}

        {initialParties.length === 0 && formMode === null ? (
          <EmptyState
            icon={FileText}
            title="No JBCC parties yet"
            description="Add the employer, contractor, principal agent and other parties referenced in your JBCC notices."
            dense
            action={
              canEdit ? (
                <Button size="sm" variant="secondary" onClick={openAdd}>
                  + Add party
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div>
            {initialParties.map(party => (
              <div key={party.id}>
                {formMode === party.id ? (
                  <PartyForm
                    initial={editValues}
                    onSave={values => handleSaveEdit(party.id, values)}
                    onCancel={closeForm}
                    isPending={isPending}
                  />
                ) : (
                  <PartyRow
                    party={party}
                    canEdit={canEdit}
                    onEdit={() => openEdit(party)}
                    onDelete={() => handleDelete(party)}
                    isDeleting={deletingId === party.id}
                  />
                )}
              </div>
            ))}

            {formMode === 'add' && (
              <PartyForm
                initial={editValues}
                onSave={handleSaveAdd}
                onCancel={closeForm}
                isPending={isPending}
              />
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
