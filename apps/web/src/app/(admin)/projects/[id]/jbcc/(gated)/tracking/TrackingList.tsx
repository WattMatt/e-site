'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { deadlineStatus, type JbccLetter, type JbccNotice, type DeadlineStatus } from '@esite/shared'

interface Props {
  projectId: string
  letters: JbccLetter[]
  noticeById: Record<string, JbccNotice>
}

const STATUS_CHIP: Record<JbccLetter['status'], string> = {
  draft:  'bg-zinc-200 text-zinc-700',
  issued: 'bg-blue-100 text-blue-700',
  served: 'bg-green-100 text-green-700',
}

const DEADLINE_CHIP: Record<DeadlineStatus, { label: string; cls: string }> = {
  clear:       { label: 'On track',  cls: 'bg-green-100 text-green-700' },
  due_soon:    { label: 'Due soon',  cls: 'bg-amber-100 text-amber-700' },
  overdue:     { label: 'Overdue',   cls: 'bg-red-100 text-red-700' },
  no_deadline: { label: 'See rule',  cls: 'bg-zinc-100 text-zinc-600' },
}

export function TrackingList({ projectId, letters, noticeById }: Props) {
  const today = useMemo(() => {
    const d = new Date()
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  }, [])

  if (letters.length === 0) {
    return (
      <div className="px-6 py-12 text-center opacity-60 text-sm">
        No letters yet. Generate one from the Library.
      </div>
    )
  }

  return (
    <div className="px-6 py-8">
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900/30 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Notice</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Trigger</th>
              <th className="px-3 py-2 font-medium">Deadline</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {letters.map(l => {
              const notice = noticeById[l.notice_id]
              const deadline = l.deadline_date ? new Date(`${l.deadline_date}T00:00:00.000Z`) : null
              const ds = deadlineStatus(deadline, today)
              return (
                <tr key={l.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs opacity-60">{notice?.code ?? '—'}</div>
                    <div className="text-sm">{notice?.title ?? 'Unknown notice'}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CHIP[l.status]}`}>
                      {l.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs opacity-70">{l.trigger_date ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {l.deadline_date ? (
                      <span className="flex items-center gap-2">
                        <span className="opacity-70">{l.deadline_date}</span>
                        <span className={`px-2 py-0.5 rounded-full font-medium ${DEADLINE_CHIP[ds].cls}`}>
                          {DEADLINE_CHIP[ds].label}
                        </span>
                      </span>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-full font-medium ${DEADLINE_CHIP.no_deadline.cls}`}>
                        {DEADLINE_CHIP.no_deadline.label}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/projects/${projectId}/jbcc/tracking/${l.id}`}
                      className="text-xs opacity-60 hover:opacity-100"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
