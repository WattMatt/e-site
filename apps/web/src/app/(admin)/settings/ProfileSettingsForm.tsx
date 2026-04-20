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

  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="ob-label">Email</label>
        <input className="ob-input" style={{ opacity: 0.6, cursor: 'not-allowed' }} value={email} disabled />
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>Contact support to change your email.</p>
      </div>
      <div>
        <label className="ob-label">Full name</label>
        <input className="ob-input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
      </div>
      <div>
        <label className="ob-label">Phone</label>
        <input className="ob-input" value={ph} onChange={e => setPh(e.target.value)} placeholder="+27 82 000 0000" type="tel" />
      </div>
      {error && <p style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button type="submit" size="sm" isLoading={saving}>Save</Button>
        {saved && <span style={{ color: '#34d399', fontSize: 12 }}>Saved!</span>}
      </div>
    </form>
  )
}
