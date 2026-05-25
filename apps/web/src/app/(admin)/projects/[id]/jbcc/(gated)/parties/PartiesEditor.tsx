'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { JbccParty, PartyRole } from '@esite/shared'
import {
  createPartyAction, updatePartyAction, deletePartyAction,
} from '@/actions/jbcc.actions'

const ROLE_LABELS: Record<PartyRole, string> = {
  principal_agent: 'Principal Agent',
  employer:        'Employer',
  guarantor:       'Guarantor',
  subcontractor:   'Subcontractor',
  other:           'Other',
}

interface FormState {
  party_role: PartyRole
  name:       string
  company:    string
  address:    string
  email:      string
  phone:      string
}

const EMPTY_FORM: FormState = {
  party_role: 'principal_agent',
  name: '', company: '', address: '', email: '', phone: '',
}

function partyToForm(p: JbccParty): FormState {
  return {
    party_role: p.party_role,
    name:       p.name,
    company:    p.company ?? '',
    address:    p.address ?? '',
    email:      p.email   ?? '',
    phone:      p.phone   ?? '',
  }
}

interface Props {
  projectId: string
  initialParties: JbccParty[]
}

export function PartiesEditor({ projectId, initialParties }: Props) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [form, setForm]           = useState<FormState>(EMPTY_FORM)
  const [error, setError]         = useState<string | null>(null)
  const [busy, startTransition]   = useTransition()

  const openAdd  = () => { setForm(EMPTY_FORM); setEditingId('new'); setError(null) }
  const openEdit = (p: JbccParty) => { setForm(partyToForm(p)); setEditingId(p.id); setError(null) }
  const cancel   = () => { setEditingId(null); setError(null) }

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const result = editingId === 'new'
        ? await createPartyAction(projectId, form)
        : await updatePartyAction(projectId, editingId!, form)
      if (!result.ok) { setError(result.error); return }
      setEditingId(null)
      router.refresh()
    })
  }

  const remove = (partyId: string) => {
    if (!confirm('Delete this party? Existing letters keep the recipient details they were generated with.')) return
    setError(null)
    startTransition(async () => {
      const result = await deletePartyAction(projectId, partyId)
      if (!result.ok) { setError(result.error); return }
      router.refresh()
    })
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold">Parties</h1>
        <button
          type="button"
          onClick={openAdd}
          disabled={editingId === 'new' || busy}
          className="px-3 py-1.5 text-sm rounded-md bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50"
        >
          + Add party
        </button>
      </header>

      {error && (
        <p className="mb-4 px-3 py-2 text-sm rounded-md bg-red-50 text-red-700 border border-red-200">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {initialParties.map(p => (
          <li key={p.id} className="border rounded-lg">
            {editingId === p.id ? (
              <PartyForm form={form} setForm={setForm} onSubmit={submit} onCancel={cancel} busy={busy} />
            ) : (
              <div className="px-4 py-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs opacity-60">{ROLE_LABELS[p.party_role]}</div>
                  <div className="text-sm font-medium">{p.name}</div>
                  {p.company && <div className="text-sm opacity-70">{p.company}</div>}
                  {p.email   && <div className="text-xs opacity-60">{p.email}</div>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(p)}
                    disabled={busy}
                    className="opacity-60 hover:opacity-100 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    disabled={busy}
                    className="opacity-60 hover:opacity-100 text-sm text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}

        {editingId === 'new' && (
          <li className="border rounded-lg">
            <PartyForm form={form} setForm={setForm} onSubmit={submit} onCancel={cancel} busy={busy} />
          </li>
        )}
      </ul>

      {initialParties.length === 0 && editingId !== 'new' && (
        <p className="text-sm opacity-60 text-center py-12">
          No parties yet. Add the Principal Agent and Employer to start generating letters.
        </p>
      )}
    </div>
  )
}

interface PartyFormProps {
  form: FormState
  setForm: (next: FormState) => void
  onSubmit: () => void
  onCancel: () => void
  busy: boolean
}

function PartyForm({ form, setForm, onSubmit, onCancel, busy }: PartyFormProps) {
  return (
    <form
      onSubmit={e => { e.preventDefault(); onSubmit() }}
      className="px-4 py-4 grid grid-cols-1 md:grid-cols-2 gap-3"
    >
      <label className="text-sm md:col-span-2">
        <span className="block text-xs opacity-60 mb-1">Role</span>
        <select
          value={form.party_role}
          onChange={e => setForm({ ...form, party_role: e.target.value as PartyRole })}
          className="w-full border rounded-md px-2 py-1.5 bg-transparent"
        >
          {Object.entries(ROLE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </label>

      <Field label="Name *"  value={form.name}    onChange={v => setForm({ ...form, name: v })} />
      <Field label="Company" value={form.company} onChange={v => setForm({ ...form, company: v })} />
      <Field label="Address" value={form.address} onChange={v => setForm({ ...form, address: v })} colSpan />
      <Field label="Email"   value={form.email}   onChange={v => setForm({ ...form, email: v })} type="email" />
      <Field label="Phone"   value={form.phone}   onChange={v => setForm({ ...form, phone: v })} />

      <div className="md:col-span-2 flex gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded-md opacity-70 hover:opacity-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded-md bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  colSpan?: boolean
}

function Field({ label, value, onChange, type = 'text', colSpan = false }: FieldProps) {
  return (
    <label className={`text-sm${colSpan ? ' md:col-span-2' : ''}`}>
      <span className="block text-xs opacity-60 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border rounded-md px-2 py-1.5 bg-transparent"
      />
    </label>
  )
}
