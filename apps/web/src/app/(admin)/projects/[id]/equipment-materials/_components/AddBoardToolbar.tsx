'use client'

/**
 * AddBoardToolbar — the "+ Add board" button in the Equipment & Materials page
 * header. A thin client wrapper that owns the AddBoardModal open/close state;
 * the modal wraps EquipmentForm → createEquipmentNodeAction and refreshes the
 * server-rendered list on success.
 *
 * existingCodes / existingCustomTypes are computed server-side (from the node
 * register) and passed down for the form's uniqueness check + custom-type
 * datalist seed.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { AddBoardModal } from './BoardManageModals'

export function AddBoardToolbar({
  projectId,
  existingCodes,
  existingCustomTypes,
}: {
  projectId: string
  existingCodes: string[]
  existingCustomTypes: string[]
}) {
  const [adding, setAdding] = useState(false)

  return (
    <>
      <Button type="button" variant="primary" size="sm" onClick={() => setAdding(true)}>
        + Add board
      </Button>
      {adding && (
        <AddBoardModal
          projectId={projectId}
          existingCodes={existingCodes}
          existingCustomTypes={existingCustomTypes}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  )
}
