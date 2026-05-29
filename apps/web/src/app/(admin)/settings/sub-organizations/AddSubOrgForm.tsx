'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import { createSubOrganisation } from '@/actions/sub-organisations.actions'

export function AddSubOrgForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '', address: '', phone: '',
    registration_number: '', vat_number: '',
    signatory_name: '', signatory_title: '',
  })

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
      disabled: isPending,
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    startTransition(async () => {
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]),
      ) as Record<string, string | null>
      const result = await createSubOrganisation({
        name: form.name.trim(),
        address: payload.address,
        phone: payload.phone,
        registration_number: payload.registration_number,
        vat_number: payload.vat_number,
        signatory_name: payload.signatory_name,
        signatory_title: payload.signatory_title,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSuccess(result.subOrganisation.name)
      setForm({
        name: '', address: '', phone: '',
        registration_number: '', vat_number: '',
        signatory_name: '', signatory_title: '',
      })
      router.refresh()
    })
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px',
    fontSize: 13, fontFamily: 'var(--font-sans)',
    border: '1px solid var(--c-border)', borderRadius: 4,
    background: 'var(--c-input-bg)', color: 'var(--c-text)',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10,
    color: 'var(--c-text-dim)', letterSpacing: '0.08em',
    textTransform: 'uppercase', marginBottom: 4,
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ gridColumn: 'span 2' }}>
          <label style={labelStyle}>Name *</label>
          <input type="text" placeholder="e.g. Bob's Building" {...field('name')} style={inputStyle} required />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label style={labelStyle}>Address</label>
          <textarea placeholder="Postal address" {...field('address')} style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} />
        </div>
        <div>
          <label style={labelStyle}>Phone</label>
          <input type="text" placeholder="+27 21 555 0100" {...field('phone')} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Registration #</label>
          <input type="text" placeholder="2024/123456/07" {...field('registration_number')} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>VAT #</label>
          <input type="text" placeholder="4123456789" {...field('vat_number')} style={inputStyle} />
        </div>
        <div />
        <div>
          <label style={labelStyle}>Signatory name</label>
          <input type="text" placeholder="Bob Smith" {...field('signatory_name')} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Signatory title</label>
          <input type="text" placeholder="Managing Director" {...field('signatory_title')} style={inputStyle} />
        </div>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--c-danger)', background: 'var(--c-danger-dim)', border: '1px solid var(--c-danger)', borderRadius: 4 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--c-green)', background: 'var(--c-green-dim)', border: '1px solid var(--c-green)', borderRadius: 4 }}>
          Created {success}.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="submit" isLoading={isPending} disabled={isPending || !form.name.trim()} size="sm">
          + Create sub-organisation
        </Button>
      </div>
    </form>
  )
}
