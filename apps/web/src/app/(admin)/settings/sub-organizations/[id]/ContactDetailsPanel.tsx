'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { SubOrganisation } from '@esite/shared'

import { Button } from '@/components/ui/Button'
import { updateSubOrganisation } from '@/actions/sub-organisations.actions'

interface Props { subOrg: SubOrganisation }

const FIELDS = [
  ['name', 'Name *'],
  ['address', 'Address'],
  ['phone', 'Phone'],
  ['registration_number', 'Registration #'],
  ['vat_number', 'VAT #'],
  ['signatory_name', 'Signatory name'],
  ['signatory_title', 'Signatory title'],
] as const

export function ContactDetailsPanel({ subOrg }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const initial = {
    name: subOrg.name ?? '',
    address: subOrg.address ?? '',
    phone: subOrg.phone ?? '',
    registration_number: subOrg.registration_number ?? '',
    vat_number: subOrg.vat_number ?? '',
    signatory_name: subOrg.signatory_name ?? '',
    signatory_title: subOrg.signatory_title ?? '',
  }
  const [form, setForm] = useState(initial)

  const dirty = (Object.keys(initial) as Array<keyof typeof initial>)
    .some((k) => form[k] !== initial[k])

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
    setSaved(false)
    const patch = (Object.keys(initial) as Array<keyof typeof initial>).reduce(
      (acc, key) => {
        if (form[key] !== initial[key]) {
          (acc as Record<string, string | null>)[key] = form[key].trim() === '' ? null : form[key].trim()
        }
        return acc
      },
      {} as Partial<Record<keyof typeof initial, string | null>>,
    )
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    startTransition(async () => {
      const result = await updateSubOrganisation(subOrg.id, patch as Record<string, never>)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 13,
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
        {FIELDS.map(([key, label]) => (
          <div key={key} style={key === 'address' ? { gridColumn: 'span 2' } : undefined}>
            <label style={labelStyle}>{label}</label>
            {key === 'address' ? (
              <textarea {...field(key)} style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} />
            ) : (
              <input type="text" {...field(key)} style={inputStyle} required={key === 'name'} />
            )}
          </div>
        ))}
      </div>
      {error && (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--c-danger)', background: 'var(--c-danger-dim)', border: '1px solid var(--c-danger)', borderRadius: 4 }}>
          {error}
        </div>
      )}
      {saved && !dirty && (
        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--c-green)', background: 'var(--c-green-dim)', border: '1px solid var(--c-green)', borderRadius: 4 }}>
          Saved.
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="submit" isLoading={isPending} disabled={isPending || !dirty} size="sm">
          Save
        </Button>
      </div>
    </form>
  )
}
