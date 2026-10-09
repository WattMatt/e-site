'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { saveProfileAction, type ParticipantProfile } from '@/actions/tender-portal.actions'
import { BBBEE_LEVELS, validateProfile, type ProfileInput } from '@/lib/tender/profile'

const LABELS: Record<keyof ProfileInput, string> = {
  companyName: 'Registered company name',
  registrationNumber: 'CIPC registration number',
  vatNumber: 'VAT number (if registered)',
  cidbGrade: 'CIDB grading',
  bbbeeLevel: 'B-BBEE level',
  contactName: 'Contact person',
  phone: 'Phone',
}

export function ProfileForm({ tenderId, initial }: { tenderId: string; initial: ParticipantProfile | null }) {
  const router = useRouter()
  const [v, setV] = useState<ProfileInput>({
    companyName: initial?.company_name ?? '',
    registrationNumber: initial?.registration_number ?? '',
    vatNumber: initial?.vat_number ?? '',
    cidbGrade: initial?.cidb_grade ?? '',
    bbbeeLevel: initial?.bbbee_level ?? '',
    contactName: initial?.contact_name ?? '',
    phone: initial?.phone ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function save() {
    const local = validateProfile(v)
    setErrors(local)
    if (Object.keys(local).length) return setMsg({ ok: false, text: 'Some details need attention' })
    setBusy(true)
    setMsg(null)
    try {
      const r = await saveProfileAction(tenderId, v)
      if ('error' in r) {
        if ('fields' in r) setErrors(r.fields)
        return setMsg({ ok: false, text: r.error })
      }
      setMsg({ ok: true, text: 'Saved.' })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const field = (k: keyof ProfileInput) => (
    <label key={k} style={{ display: 'grid', gap: 4, fontSize: 14 }}>
      {LABELS[k]}
      {k === 'bbbeeLevel' ? (
        <select value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-invalid={!!errors[k]}>
          <option value="">Choose…</option>
          {BBBEE_LEVELS.map((l) => <option key={l} value={l}>{l === 'non-compliant' ? 'Non-compliant' : `Level ${l}`}</option>)}
        </select>
      ) : (
        <input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-invalid={!!errors[k]} />
      )}
      {errors[k] && <span role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{errors[k]}</span>}
    </label>
  )

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {initial?.profile_completed_at && <p style={{ margin: 0, fontSize: 13 }}>Details complete. You can update them until the tender closes.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {(Object.keys(LABELS) as (keyof ProfileInput)[]).map(field)}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button isLoading={busy} onClick={save}>Save company details</Button>
        {msg && <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</span>}
      </div>
    </div>
  )
}
