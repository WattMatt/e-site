'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'

export function RfiRespondForm({ rfiId }: { rfiId: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (body.trim().length < 10) { setError('Response must be at least 10 characters'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error: err } = await supabase.schema('projects').from('rfi_responses')
      .insert({ rfi_id: rfiId, body: body.trim(), responded_by: user.id })
    if (err) { setError(err.message); setSaving(false); return }

    await supabase.schema('projects').from('rfis').update({ status: 'responded' }).eq('id', rfiId)
    setBody('')
    router.refresh()
    setSaving(false)
  }

  return (
    <div className="space-y-3">
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={4}
        placeholder="Type your response…"
        className="w-full bg-slate-700 text-white rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
      />
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <Button size="sm" onClick={submit} isLoading={saving} disabled={!body.trim()}>
        Submit Response
      </Button>
    </div>
  )
}
