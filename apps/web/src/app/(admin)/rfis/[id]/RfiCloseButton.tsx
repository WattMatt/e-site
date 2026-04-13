'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function RfiCloseButton({ rfiId }: { rfiId: string }) {
  const [closing, setClosing] = useState(false)
  const router = useRouter()

  async function close() {
    if (!confirm('Close this RFI? This cannot be undone.')) return
    setClosing(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.schema('projects').from('rfis').update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: user?.id,
    }).eq('id', rfiId)
    router.refresh()
  }

  return (
    <button onClick={close} disabled={closing}
      className="text-sm text-slate-500 hover:text-slate-300 disabled:opacity-50 transition-colors">
      {closing ? 'Closing…' : 'Close RFI'}
    </button>
  )
}
