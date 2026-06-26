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
    <div
      className="jbcc-page-fade"
      style={{ maxWidth: 860, margin: '0 auto', padding: '48px 40px 96px' }}
    >
      {/* Page header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 40,
          paddingBottom: 20,
          borderBottom: '1px solid var(--c-border)',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--f-mono-display)',
              fontSize: 10,
              letterSpacing: '0.22em',
              color: 'var(--c-amber)',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            Project Parties
          </div>
          <h1
            style={{
              fontFamily: 'var(--f-display)',
              fontStyle: 'italic',
              fontWeight: 350,
              fontSize: 36,
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              color: 'var(--c-text)',
              margin: 0,
            }}
          >
            Parties
          </h1>
        </div>
        <button
          type="button"
          onClick={openAdd}
          disabled={editingId === 'new' || busy}
          className="jbcc-btn-cta"
        >
          + Add Party
        </button>
      </header>

      {error && (
        <div
          style={{
            marginBottom: 24,
            padding: '12px 16px',
            background: 'var(--c-red-dim-rgb, rgba(255,107,107,.10))',
            border: '1px solid var(--c-red)',
            fontFamily: 'var(--f-mono-display)',
            fontSize: 12,
            color: 'var(--c-red-bright)',
          }}
        >
          {error}
        </div>
      )}

      {/* Party card list — 1px gaps, no radius */}
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'grid',
          gap: 1,
          background: 'var(--c-border)',
        }}
      >
        {initialParties.map(p => (
          <li key={p.id} style={{ background: 'var(--c-surface)' }}>
            {editingId === p.id ? (
              <PartyForm form={form} setForm={setForm} onSubmit={submit} onCancel={cancel} busy={busy} />
            ) : (
              <div
                style={{
                  padding: '20px 24px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 16,
                }}
              >
                <div>
                  {/* Role — amber mono uppercase eyebrow */}
                  <div
                    style={{
                      fontFamily: 'var(--f-mono-display)',
                      fontSize: 10,
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                      color: 'var(--c-amber)',
                      marginBottom: 6,
                    }}
                  >
                    {ROLE_LABELS[p.party_role]}
                  </div>
                  {/* Name — Fraunces italic */}
                  <div
                    style={{
                      fontFamily: 'var(--f-display)',
                      fontStyle: 'italic',
                      fontWeight: 350,
                      fontSize: 20,
                      letterSpacing: '-0.01em',
                      color: 'var(--c-text)',
                      marginBottom: 4,
                    }}
                  >
                    {p.name}
                  </div>
                  {p.company && (
                    <div style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{p.company}</div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      gap: 16,
                      marginTop: 8,
                      fontFamily: 'var(--f-mono-display)',
                      fontSize: 11,
                      color: 'var(--c-text-muted)',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {p.email && <span>{p.email}</span>}
                    {p.phone && <span>{p.phone}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => openEdit(p)}
                    disabled={busy}
                    className="jbcc-btn-cta"
                    style={{ fontSize: 10, padding: '6px 12px' }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    disabled={busy}
                    className="jbcc-btn-cta jbcc-btn-cta--danger"
                    style={{ fontSize: 10, padding: '6px 12px' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}

        {editingId === 'new' && (
          <li style={{ background: 'var(--c-panel)' }}>
            <PartyForm form={form} setForm={setForm} onSubmit={submit} onCancel={cancel} busy={busy} />
          </li>
        )}
      </ul>

      {initialParties.length === 0 && editingId !== 'new' && (
        <div
          style={{
            padding: '64px 24px',
            textAlign: 'center',
            fontFamily: 'var(--f-mono-display)',
            fontSize: 12,
            color: 'var(--c-text-muted)',
            letterSpacing: '0.06em',
            border: '1px dashed var(--c-border)',
          }}
        >
          No parties yet — add the Principal Agent and Employer to start generating letters
        </div>
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
      style={{
        padding: '24px',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
      }}
    >
      {/* Role selector — full width */}
      <div style={{ gridColumn: '1 / -1' }}>
        <label className="jbcc-label" htmlFor="party-role">Role</label>
        <select
          id="party-role"
          value={form.party_role}
          onChange={e => setForm({ ...form, party_role: e.target.value as PartyRole })}
          className="jbcc-input"
          style={{ appearance: 'none' }}
        >
          {Object.entries(ROLE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      <Field label="Name *"  value={form.name}    onChange={v => setForm({ ...form, name: v })} />
      <Field label="Company" value={form.company} onChange={v => setForm({ ...form, company: v })} />
      <Field label="Address" value={form.address} onChange={v => setForm({ ...form, address: v })} colSpan />
      <Field label="Email"   value={form.email}   onChange={v => setForm({ ...form, email: v })} type="email" />
      <Field label="Phone"   value={form.phone}   onChange={v => setForm({ ...form, phone: v })} />

      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="jbcc-btn-cta"
          style={{ fontSize: 10, padding: '8px 14px' }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="jbcc-btn-cta"
          style={{
            fontSize: 10,
            padding: '8px 14px',
            background: busy ? 'transparent' : 'var(--c-amber)',
            color: busy ? 'var(--c-text-muted)' : 'var(--c-base)',
            borderColor: busy ? 'var(--c-border)' : 'var(--c-amber)',
          }}
        >
          {busy ? 'Saving…' : 'Save Party'}
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
    <div style={colSpan ? { gridColumn: '1 / -1' } : {}}>
      <label className="jbcc-label">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="jbcc-input"
      />
    </div>
  )
}
