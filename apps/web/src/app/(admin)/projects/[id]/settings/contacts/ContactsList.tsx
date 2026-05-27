'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Users } from 'lucide-react'

import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, TextInput } from '@/components/ui/FormField'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  createProjectContact,
  updateProjectContact,
  deleteProjectContact,
  type Contact,
} from '@/actions/project-contacts.actions'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactFormState {
  name: string
  role: string
  company: string
  email: string
  phone: string
}

const emptyForm = (): ContactFormState => ({
  name: '',
  role: '',
  company: '',
  email: '',
  phone: '',
})

// ─── Inline form ─────────────────────────────────────────────────────────────

function ContactForm({
  initial,
  onSave,
  onCancel,
  isPending,
}: {
  initial: ContactFormState
  onSave: (values: ContactFormState) => void
  onCancel: () => void
  isPending: boolean
}) {
  const [values, setValues] = useState<ContactFormState>(initial)
  const [nameError, setNameError] = useState<string | undefined>()

  function set(field: keyof ContactFormState, value: string) {
    setValues(prev => ({ ...prev, [field]: value }))
    if (field === 'name') setNameError(undefined)
  }

  function handleSave() {
    if (!values.name.trim()) {
      setNameError('Name is required')
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
        <FormField label="Name" required error={nameError}>
          <TextInput
            value={values.name}
            onChange={e => set('name', e.target.value)}
            placeholder="Jane Smith"
            invalid={!!nameError}
          />
        </FormField>
        <FormField label="Role">
          <TextInput
            value={values.role}
            onChange={e => set('role', e.target.value)}
            placeholder="Site Manager"
          />
        </FormField>
        <FormField label="Company">
          <TextInput
            value={values.company}
            onChange={e => set('company', e.target.value)}
            placeholder="ACME Construction"
          />
        </FormField>
        <FormField label="Email">
          <TextInput
            type="email"
            value={values.email}
            onChange={e => set('email', e.target.value)}
            placeholder="jane@example.com"
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

// ─── Contact row ─────────────────────────────────────────────────────────────

function ContactRow({
  contact,
  canEdit,
  onEdit,
  onDelete,
  isDeleting,
}: {
  contact: Contact
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
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-text)' }}>
          {contact.name}
        </span>
        {(contact.role || contact.company) && (
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            {[contact.role, contact.company].filter(Boolean).join(' · ')}
          </span>
        )}
        {(contact.email || contact.phone) && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--c-text-mid)',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            {[contact.email, contact.phone].filter(Boolean).join(' · ')}
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
  initialContacts: Contact[]
  canEdit: boolean
}

export function ContactsList({ projectId, initialContacts, canEdit }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // `null` = no form open; `'add'` = add form; string contactId = edit form
  const [formMode, setFormMode] = useState<null | 'add' | string>(null)
  const [editValues, setEditValues] = useState<ContactFormState>(emptyForm())
  const [serverError, setServerError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function openAdd() {
    setEditValues(emptyForm())
    setFormMode('add')
    setServerError(null)
  }

  function openEdit(contact: Contact) {
    setEditValues({
      name: contact.name,
      role: contact.role ?? '',
      company: contact.company ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
    })
    setFormMode(contact.id)
    setServerError(null)
  }

  function closeForm() {
    setFormMode(null)
    setServerError(null)
  }

  function handleSaveAdd(values: ContactFormState) {
    startTransition(async () => {
      const result = await createProjectContact(projectId, {
        name: values.name,
        role: values.role || null,
        company: values.company || null,
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

  function handleSaveEdit(contactId: string, values: ContactFormState) {
    startTransition(async () => {
      const result = await updateProjectContact(contactId, {
        name: values.name,
        role: values.role || null,
        company: values.company || null,
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

  function handleDelete(contact: Contact) {
    if (!confirm(`Delete contact '${contact.name}'?`)) return
    setDeletingId(contact.id)
    startTransition(async () => {
      const result = await deleteProjectContact(contact.id)
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
              Project contacts
            </div>
            <div style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 2 }}>
              Quick-reference contact list for this project. Used in reports + RFI emails.
            </div>
          </div>
          {canEdit && formMode === null && (
            <Button size="sm" variant="secondary" onClick={openAdd}>
              + Add contact
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

        {initialContacts.length === 0 && formMode === null ? (
          <EmptyState
            icon={Users}
            title="No contacts yet"
            description="Add contacts to keep a quick-reference list for this project."
            dense
            action={
              canEdit ? (
                <Button size="sm" variant="secondary" onClick={openAdd}>
                  + Add contact
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div>
            {initialContacts.map(contact => (
              <div key={contact.id}>
                {formMode === contact.id ? (
                  <ContactForm
                    initial={editValues}
                    onSave={values => handleSaveEdit(contact.id, values)}
                    onCancel={closeForm}
                    isPending={isPending}
                  />
                ) : (
                  <ContactRow
                    contact={contact}
                    canEdit={canEdit}
                    onEdit={() => openEdit(contact)}
                    onDelete={() => handleDelete(contact)}
                    isDeleting={deletingId === contact.id}
                  />
                )}
              </div>
            ))}

            {formMode === 'add' && (
              <ContactForm
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
