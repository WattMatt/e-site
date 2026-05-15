'use client'

import { useState } from 'react'
import type { StructureTreeNode } from '@esite/shared'
import { StructurePanel } from './StructurePanel'
import { AddEntityPanel } from './AddEntityPanel'
import { type NodeOption } from './CableScheduleGrid'

interface Props {
  revisionId: string
  roots: StructureTreeNode[]
  unfed: StructureTreeNode[]
  canEdit: boolean
  sources: NodeOption[]
  boards: NodeOption[]
}

/**
 * Thin client wrapper that holds the shared "feed-from" state: clicking
 * "+ feed a board" on a tree node in StructurePanel pre-seeds the Add-cable
 * form's "From". page.tsx is a server component and can't hold this state.
 */
export function StructureSection({ revisionId, roots, unfed, canEdit, sources, boards }: Props) {
  const [feedFrom, setFeedFrom] = useState<string | null>(null)
  return (
    <>
      <StructurePanel
        revisionId={revisionId}
        roots={roots}
        unfed={unfed}
        canEdit={canEdit}
        onFeedBoard={(fromKey) => setFeedFrom(fromKey)}
      />
      {canEdit && (
        <AddEntityPanel
          revisionId={revisionId}
          sources={sources}
          boards={boards}
          feedFromKey={feedFrom}
          onFeedConsumed={() => setFeedFrom(null)}
        />
      )}
    </>
  )
}
