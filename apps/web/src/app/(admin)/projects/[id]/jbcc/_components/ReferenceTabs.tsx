'use client'

import { useState } from 'react'
import type { JbccNotice, JbccClause, JbccTimeBar } from '@esite/shared'
import { NoticeLibrary } from './NoticeLibrary'
import { ClauseRegister } from './ClauseRegister'
import { TimeBarSchedule } from './TimeBarSchedule'

type View = 'notices' | 'clauses' | 'timebars'

const VIEWS: View[] = ['notices', 'clauses', 'timebars']

interface Props {
  projectId: string
  initialView: string
  notices: JbccNotice[]
  clauses: JbccClause[]
  timebars: JbccTimeBar[]
}

export function ReferenceTabs({
  projectId, initialView, notices, clauses, timebars,
}: Props) {
  const [view, setView] = useState<View>(
    (VIEWS as readonly string[]).includes(initialView)
      ? (initialView as View)
      : 'notices',
  )

  const TabButton = ({ id, label }: { id: View; label: string }) => (
    <button
      type="button"
      onClick={() => setView(id)}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
        view === id
          ? 'border-amber-600'
          : 'border-transparent opacity-60 hover:opacity-100'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div className="border-b px-6 flex gap-1">
        <TabButton id="notices"  label="Notices" />
        <TabButton id="clauses"  label="Clause register" />
        <TabButton id="timebars" label="Time-bar schedule" />
      </div>

      {view === 'notices'  && <NoticeLibrary projectId={projectId} notices={notices} />}
      {view === 'clauses'  && <ClauseRegister clauses={clauses} />}
      {view === 'timebars' && <TimeBarSchedule timebars={timebars} />}
    </div>
  )
}
