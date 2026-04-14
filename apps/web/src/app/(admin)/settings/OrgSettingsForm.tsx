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

  const inp = 'w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">Organisation name *</label>
        <input className={inp} value={orgName} onChange={e => setOrgName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Registration No.</label>
          <input className={inp} value={regNo} onChange={e => setRegNo(e.target.value)} placeholder="2024/000000/07" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">VAT No.</label>
          <input className={inp} value={vat} onChange={e => setVat(e.target.value)} placeholder="4000000000" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Phone</label>
          <input className={inp} value={ph} onChange={e => setPh(e.target.value)} placeholder="+27 11 000 0000" type="tel" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Website</label>
          <input className={inp} value={web} onChange={e => setWeb(e.target.value)} placeholder="https://..." type="url" />
        </div>
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" isLoading={saving}>Save</Button>
        {saved && <span className="text-emerald-400 text-xs">Saved!</span>}
      </div>
    </form>
  )
}
