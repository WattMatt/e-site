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
      onClick={revoke}
      disabled={revoking}
      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
    >
      {revoking ? 'Revoking…' : 'Revoke'}
    </button>
  )
}
