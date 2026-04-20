'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { orgService } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const [revoking, setRevoking] = useState(false)
  const router = useRouter()

  async function revoke() {
    if (!confirm('Revoke this invite?')) return
    setRevoking(true)
    const supabase = createClient()
    await orgService.revokeInvite(supabase as any, inviteId)
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={revoke}
      disabled={revoking}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--c-red)',
        background: 'transparent',
        border: 'none',
        cursor: revoking ? 'wait' : 'pointer',
        opacity: revoking ? 0.5 : 1,
        letterSpacing: '0.04em',
      }}
    >
      {revoking ? 'Revoking…' : 'Revoke'}
    </button>
  )
}
