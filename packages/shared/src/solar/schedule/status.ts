/**
 * Gantt status (spec §14.1: not started / in progress / done). Stored in
 * solar.schedule_tasks.gantt_status; the work item's universal status is kept
 * in step by the RPCs in 00213. This function is the READ side only.
 */
export const GANTT_STATUSES = ['not_started', 'in_progress', 'done'] as const
export type GanttStatus = (typeof GANTT_STATUSES)[number]
export const GANTT_STATUS_LABELS: Record<GanttStatus, string> = {
  not_started: 'Not started', in_progress: 'In progress', done: 'Done',
}
export const isGanttStatus = (v: unknown): v is GanttStatus => (GANTT_STATUSES as readonly unknown[]).includes(v)

export function ganttStatusOf(
  workItemStatus: string,
  stored: GanttStatus,
): { status: GanttStatus; awaitingSignOff: boolean } | null {
  if (workItemStatus === 'void') return null
  if (workItemStatus === 'closed') return { status: 'done', awaitingSignOff: false }
  if (workItemStatus === 'answered') return { status: 'done', awaitingSignOff: true }
  return { status: stored === 'done' ? 'in_progress' : stored, awaitingSignOff: false }
}
