'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'

export function OrgSettingsForm({ orgId, name, registrationNumber, vatNumber, phone, website }: {
  orgId: string; name: string; registrationNumber: string; vatNumber: string; phone: string; website: string
}) {
  const [orgName, setOrgName] = useState(name)
  const [regNo, setRegNo] = useState(registrationNumber)
  const [vat, setVat] = useState(vatNumber)
  const [ph, setPh] = useState(phone)
  const [web, setWeb] = useState(website)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!orgName.trim()) { setError('Name is required'); return }
    setSaving(true); setError(null); setSaved(false)
    const supabase = createClient()
    const { error: err } = await supabase
      .from('organisations')
      .update({
        name: orgName.trim(),
        registration_number: regNo.trim() || null,
        vat_number: vat.trim() || null,
        phone: ph.trim() || null,
        website: web.trim() || null,
      })
      .eq('id', orgId)
    if (err) { setError(err.message) } else { setSaved(true); setTimeout(() => setSaved(false), 3000) }
    setSaving(false)
  }

  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="ob-label">Organisation name *</label>
        <input className="ob-input" value={orgName} onChange={e => setOrgName(e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label className="ob-label">Registration No.</label>
          <input className="ob-input" value={regNo} onChange={e => setRegNo(e.target.value)} placeholder="2024/000000/07" />
        </div>
        <div>
          <label className="ob-label">VAT No.</label>
          <input className="ob-input" value={vat} onChange={e => setVat(e.target.value)} placeholder="4000000000" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label className="ob-label">Phone</label>
          <input className="ob-input" value={ph} onChange={e => setPh(e.target.value)} placeholder="+27 11 000 0000" type="tel" />
        </div>
        <div>
          <label className="ob-label">Website</label>
          <input className="ob-input" value={web} onChange={e => setWeb(e.target.value)} placeholder="https://..." type="url" />
        </div>
      </div>
      {error && <p style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button type="submit" size="sm" isLoading={saving}>Save</Button>
        {saved && <span style={{ color: '#34d399', fontSize: 12 }}>Saved!</span>}
      </div>
    </form>
  )
}
