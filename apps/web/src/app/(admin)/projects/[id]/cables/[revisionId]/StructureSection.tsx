'use client'

import { useState, type ReactNode } from 'react'
import type { StructureTreeNode } from '@esite/shared'
import { StructurePanel } from './StructurePanel'
import { AddEntityPanel } from './AddEntityPanel'
import { type NodeOption } from './CableScheduleGrid'

interface Props {
  projectId: string
  revisionId: string
  roots: StructureTreeNode[]
  unfed: StructureTreeNode[]
  canEdit: boolean
  sources: NodeOption[]
  boards: NodeOption[]
  /** Already-fed "fromKey|toBoardId" pairs — hides a destination from the Add-cable "To" list once that specific From feeds it. */
  fedPairs: string[]
  /** Schedule grid (or empty-state) rendered between the structure tree and the Add-cable panel. */
  children?: ReactNode
  /** Auto-open the Add-cable panel on first render (e.g. when the revision has zero cables). */
  addPanelDefaultOpen?: boolean
}

/**
 * Thin client wrapper that holds the shared "feed-from" state: clicking
 * "+ feed a board" on a tree node in StructurePanel pre-seeds the Add-cable
 * form's "From". page.tsx is a server component and can't hold this state.
 *
 * Layout: StructurePanel → {children: schedule grid} → AddEntityPanel. The
 * Add-cable panel sits BELOW the grid so it's the natural next step after
 * the engineer's eye lands on the (often empty) table.
 */
export function StructureSection({
  projectId,
  revisionId,
  roots,
  unfed,
  canEdit,
  sources,
  boards,
  fedPairs,
  children,
  addPanelDefaultOpen = false,
}: Props) {
  const [feedFrom, setFeedFrom] = useState<string | null>(null)
  return (
    <>
      <StructurePanel
        projectId={projectId}
        revisionId={revisionId}
        roots={roots}
        unfed={unfed}
        canEdit={canEdit}
        onFeedBoard={(fromKey) => setFeedFrom(fromKey)}
      />
      {children}
      {canEdit && (
        <AddEntityPanel
          projectId={projectId}
          revisionId={revisionId}
          sources={sources}
          boards={boards}
          fedPairs={fedPairs}
          feedFromKey={feedFrom}
          onFeedConsumed={() => setFeedFrom(null)}
          defaultOpen={addPanelDefaultOpen}
        />
      )}
    </>
  )
}
