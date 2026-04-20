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
    <button
      onClick={close}
      disabled={closing}
      style={{
        fontSize: 12, color: 'var(--c-text-dim)', background: 'var(--c-panel)',
        border: '1px solid var(--c-border)', borderRadius: 6, padding: '6px 14px',
        cursor: closing ? 'not-allowed' : 'pointer', opacity: closing ? 0.5 : 1,
        transition: 'all 0.12s',
      }}
    >
      {closing ? 'Closing…' : 'Close RFI'}
    </button>
  )
}
