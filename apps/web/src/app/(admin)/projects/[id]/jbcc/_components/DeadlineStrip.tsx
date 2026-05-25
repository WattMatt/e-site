import Link from 'next/link'
import { deadlineStatus, type JbccLetter } from '@esite/shared'

interface Props {
  projectId: string
  letters:   JbccLetter[]
}

export function DeadlineStrip({ projectId, letters }: Props) {
  const today = new Date()
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))

  const openLetters = letters.filter(l => l.status !== 'served')

  let overdue  = 0
  let dueSoon  = 0
  for (const l of openLetters) {
    const deadline = l.deadline_date ? new Date(`${l.deadline_date}T00:00:00.000Z`) : null
    const ds = deadlineStatus(deadline, todayUtc)
    if (ds === 'overdue')  overdue++
    if (ds === 'due_soon') dueSoon++
  }

  if (overdue === 0 && dueSoon === 0) return null

  return (
    <div
      style={{
        borderBottom: '2px solid var(--c-danger, #ef4444)',
        background: 'var(--c-danger-dim, #fef2f2)',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        fontSize: 13,
        color: 'var(--c-text)',
      }}
    >
      <span>
        <strong>{overdue}</strong> overdue · <strong>{dueSoon}</strong> due soon
      </span>
      <Link
        href={`/projects/${projectId}/jbcc/tracking`}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--c-danger, #ef4444)',
          textDecoration: 'none',
          letterSpacing: '0.06em',
        }}
      >
        View tracking →
      </Link>
    </div>
  )
}
