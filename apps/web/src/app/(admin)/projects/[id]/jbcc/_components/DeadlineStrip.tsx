import { deadlineStatus, type JbccLetter, type JbccNotice } from '@esite/shared'
import { UrgencyStrip } from './procedural/UrgencyStrip'

interface Props {
  projectId: string
  letters:   JbccLetter[]
  notices?:  JbccNotice[]
}

/**
 * Computes overdue/due-soon counts from the open letters and renders
 * the urgency hero strip from the Procedural mockup.
 * Returns null when all deadlines are clear.
 */
export function DeadlineStrip({ projectId, letters, notices = [] }: Props) {
  const today = new Date()
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))

  const noticeMap = new Map(notices.map(n => [n.id, n]))

  const openLetters = letters.filter(l => l.status !== 'served')

  const urgentItems: Array<{ letter: JbccLetter; ds: 'overdue' | 'due_soon'; daysLabel: string }> = []

  for (const l of openLetters) {
    const deadline = l.deadline_date ? new Date(`${l.deadline_date}T00:00:00.000Z`) : null
    const ds = deadlineStatus(deadline, todayUtc)
    if (ds === 'overdue' || ds === 'due_soon') {
      const msPerDay = 86400000
      const diffMs = deadline ? deadline.getTime() - todayUtc.getTime() : 0
      const diffDays = Math.round(Math.abs(diffMs) / msPerDay)
      const daysLabel = ds === 'overdue'
        ? `${diffDays} WD overdue`
        : `${diffDays} WD remaining`
      urgentItems.push({ letter: l, ds, daysLabel })
    }
  }

  const overdue = urgentItems.filter(i => i.ds === 'overdue').length
  const dueSoon = urgentItems.filter(i => i.ds === 'due_soon').length

  if (overdue === 0 && dueSoon === 0) return null

  const items = urgentItems.map(({ letter, daysLabel }) => {
    const notice = noticeMap.get(letter.notice_id)
    return {
      code:     notice?.code  ?? '—',
      title:    notice?.title ?? 'Unknown notice',
      dueLabel: daysLabel,
    }
  })

  return (
    <UrgencyStrip
      overdue={overdue}
      dueSoon={dueSoon}
      items={items}
      trackingHref={`/projects/${projectId}/jbcc/tracking`}
    />
  )
}
