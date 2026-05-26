'use client'

import type { JbccNotice, JbccLetter } from '@esite/shared'
import { deadlineStatus } from '@esite/shared'
import { useMemo } from 'react'
import { SectionHeader } from './procedural/SectionHeader'
import { NoticeCard } from './procedural/NoticeCard'

const CATEGORY_ORDER = [
  'Changes, Delays & Site Conditions',
  'Financial & Security',
  'Performance & Administrative',
  'Subcontract',
  'Suspension & Termination',
  'Dispute Resolution',
] as const

// Section numbers matching the JBCC contract part numbering aesthetic
const CATEGORY_SECTION: Record<string, string> = {
  'Changes, Delays & Site Conditions': '§ 01',
  'Financial & Security':              '§ 02',
  'Performance & Administrative':      '§ 03',
  'Subcontract':                       '§ 04',
  'Suspension & Termination':          '§ 05',
  'Dispute Resolution':                '§ 06',
}

interface Props {
  projectId: string
  notices: JbccNotice[]
  letters?: JbccLetter[]
}

export function NoticeLibrary({ projectId, notices, letters = [] }: Props) {
  const today = useMemo(() => {
    const d = new Date()
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  }, [])

  // Build per-notice letter state maps
  const activeByNotice = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of letters) {
      if (l.status !== 'served') {
        map.set(l.notice_id, (map.get(l.notice_id) ?? 0) + 1)
      }
    }
    return map
  }, [letters])

  const overdueByNotice = useMemo(() => {
    const set = new Set<string>()
    for (const l of letters) {
      if (l.status === 'served') continue
      const deadline = l.deadline_date ? new Date(`${l.deadline_date}T00:00:00.000Z`) : null
      if (deadlineStatus(deadline, today) === 'overdue') {
        set.add(l.notice_id)
      }
    }
    return set
  }, [letters, today])

  const byCategory = useMemo(() => {
    const map = new Map<string, JbccNotice[]>()
    for (const n of notices) {
      const bucket = map.get(n.category) ?? []
      bucket.push(n)
      map.set(n.category, bucket)
    }
    return map
  }, [notices])

  return (
    <div style={{ padding: '48px 0 0' }}>
      {CATEGORY_ORDER.filter(c => byCategory.has(c)).map(category => {
        const categoryNotices = byCategory.get(category)!
        return (
          <section key={category} style={{ marginBottom: 48 }}>
            <SectionHeader
              num={CATEGORY_SECTION[category] ?? '§'}
              title={category}
              count={`${String(categoryNotices.length).padStart(2, '0')} notices`}
            />
            <div className="jbcc-notice-grid">
              {categoryNotices.map(n => {
                const timeBarLabel = n.time_bar_days !== null
                  ? `${n.time_bar_days} ${n.time_bar_unit ?? ''}`
                  : 'Promptly'
                const clauseRef = `cl. ${n.triggering_clause}`
                const direction = `${n.from_party} → ${n.to_party}`
                const activeCount = activeByNotice.get(n.id) ?? 0
                const isOverdue = overdueByNotice.has(n.id)

                return (
                  <NoticeCard
                    key={n.code}
                    code={n.code}
                    title={n.title}
                    summary={n.purpose ?? null}
                    timeBarLabel={timeBarLabel}
                    clauseRef={clauseRef}
                    direction={direction}
                    href={`/projects/${projectId}/jbcc/notice/${n.code}`}
                    activeLetterCount={activeCount}
                    isOverdue={isOverdue}
                  />
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
