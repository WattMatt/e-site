'use client'

import { useState } from 'react'
import type { SubOrgMember } from '@/actions/sub-org-members.actions'
import { SubOrgRosterPanel } from './SubOrgRosterPanel'
import { SubOrgBulkInviteModal } from './SubOrgBulkInviteModal'

interface Props {
  subOrgId:       string
  initialMembers: SubOrgMember[]
}

export function RosterSection({ subOrgId, initialMembers }: Props) {
  const [bulkOpen, setBulkOpen] = useState(false)

  return (
    <>
      <SubOrgRosterPanel
        subOrgId={subOrgId}
        initialMembers={initialMembers}
        onOpenBulkInvite={() => setBulkOpen(true)}
      />
      <SubOrgBulkInviteModal
        subOrgId={subOrgId}
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
      />
    </>
  )
}
