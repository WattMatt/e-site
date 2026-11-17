'use client'

import type { ProgrammeSummary, ProgrammeViewData } from '@/lib/programme/view-types'

/** Stub: Task 3 builds the grid and timeline. For now it names the programme. */
export function ProgrammeClient({ view }: {
  projectId: string
  view: ProgrammeViewData
  canEdit: boolean
  programmes: ProgrammeSummary[]
}) {
  return (
    <div className="page">
      <div className="page-header"><h1 className="page-title">{view.state.programme.name}</h1></div>
    </div>
  )
}
