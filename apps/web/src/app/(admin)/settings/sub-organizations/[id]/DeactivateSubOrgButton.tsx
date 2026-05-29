'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'

interface Props {
  subOrgId: string
  isActive: boolean
  orgName: string
  setSubOrgActive: (subOrgId: string, active: boolean) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function DeactivateSubOrgButton({ subOrgId, isActive, orgName, setSubOrgActive }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (isActive) {
      const confirmed = confirm(
        `Deactivate ${orgName}? Their roster and project memberships will stay in place — only the status label changes.`,
      )
      if (!confirmed) return
    }

    startTransition(async () => {
      const result = await setSubOrgActive(subOrgId, !isActive)
      if (!result.ok) {
        alert(result.error)
        return
      }
      router.refresh()
    })
  }

  return isActive ? (
    <Button variant="ghost" size="sm" onClick={handleClick} disabled={isPending} isLoading={isPending}>
      Deactivate sub-org
    </Button>
  ) : (
    <Button variant="secondary" size="sm" onClick={handleClick} disabled={isPending} isLoading={isPending}>
      Reactivate sub-org
    </Button>
  )
}
