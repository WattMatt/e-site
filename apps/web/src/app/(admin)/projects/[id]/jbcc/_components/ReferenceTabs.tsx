'use client'

import { useState } from 'react'
import type { JbccNotice, JbccClause, JbccTimeBar, JbccLetter } from '@esite/shared'
import { NoticeLibrary } from './NoticeLibrary'
import { ClauseRegister } from './ClauseRegister'
import { TimeBarSchedule } from './TimeBarSchedule'

type View = 'notices' | 'clauses' | 'timebars'

const VIEWS: View[] = ['notices', 'clauses', 'timebars']

const TAB_LABELS: Record<View, string> = {
  notices:  'Notice Library',
  clauses:  'Clause Register',
  timebars: 'Time-Bar Schedule',
}

interface Props {
  projectId: string
  initialView: string
  notices: JbccNotice[]
  clauses: JbccClause[]
  timebars: JbccTimeBar[]
  letters?: JbccLetter[]
}

export function ReferenceTabs({
  projectId, initialView, notices, clauses, timebars, letters = [],
}: Props) {
  const [view, setView] = useState<View>(
    (VIEWS as readonly string[]).includes(initialView)
      ? (initialView as View)
      : 'notices',
  )

  return (
    <div>
      {/* Tab bar — mono caps, amber top-border active indicator */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--c-border)',
          gap: 0,
        }}
      >
        {VIEWS.map(id => (
          <button
            key={id}
            type="button"
            className="jbcc-tab-btn"
            data-active={view === id ? 'true' : 'false'}
            onClick={() => setView(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      {/* Panel content */}
      {view === 'notices'  && (
        <NoticeLibrary projectId={projectId} notices={notices} letters={letters} />
      )}
      {view === 'clauses'  && <ClauseRegister clauses={clauses} />}
      {view === 'timebars' && <TimeBarSchedule timebars={timebars} />}
    </div>
  )
}
