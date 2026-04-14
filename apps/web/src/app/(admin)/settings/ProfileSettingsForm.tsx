'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'

export function ProfileSettingsForm({ userId, fullName, phone, email }: {
  userId: string; fullName: string; phone: string; email: string
}) {
  const [name, setName] = useState(fullName)
  const [ph, setPh] = useState(phone)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null); setSaved(false)
    const supabase = createClient()
    const { error: err } = await supabase
      .from('profiles')
      .update({ full_name: name.trim(), phone: ph.trim() || null })
      .eq('id', userId)
    if (err) { setError(err.message) } else { setSaved(true); setTimeout(() => setSaved(false), 3000) }
    setSaving(false)
  }

  const inp = 'w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">Email</label>
        <input className={`${inp} opacity-60 cursor-not-allowed`} value={email} disabled />
        <p className="text-xs text-slate-500 mt-1">Contact support to change your email.</p>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">Full name</label>
        <input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">Phone</label>
        <input className={inp} value={ph} onChange={e => setPh(e.target.value)} placeholder="+27 82 000 0000" type="tel" />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" isLoading={saving}>Save</Button>
        {saved && <span className="text-emerald-400 text-xs">Saved!</span>}
      </div>
    </form>
  )
}
