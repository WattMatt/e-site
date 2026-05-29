'use client'

import { useState } from 'react'
import type { SubOrgMember } from '@/actions/sub-org-members.actions'
import { SubOrgRosterPanel } from './SubOrgRosterPanel'
import { SubOrgBulkInviteModal } from './SubOrgBulkInviteModal'

interface Props {
  subOrgId:       string
  parentOrgId:    string
  initialMembers: SubOrgMember[]
}

export function RosterSection({ subOrgId, parentOrgId, initialMembers }: Props) {
  const [bulkOpen, setBulkOpen] = useState(false)

  return (
    <>
      <SubOrgRosterPanel
        subOrgId={subOrgId}
        parentOrgId={parentOrgId}
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
