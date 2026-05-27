'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { History } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { restoreProjectSettingsAction } from '@/actions/project-settings.actions'
import type { ProjectSettingsHistoryRow } from '@esite/shared'

interface Props {
  projectId: string
  rows: ProjectSettingsHistoryRow[]
  nameById: Record<string, string>
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function describeDiff(diff: Record<string, [unknown, unknown]> | null): {
  summary: string
  fieldCount: number
} {
  if (!diff) return { summary: 'Initial snapshot', fieldCount: 0 }
  const keys = Object.keys(diff)
  if (keys.length === 0) return { summary: 'No changes recorded', fieldCount: 0 }
  if (keys.length === 1) {
    const key = keys[0]
    const [oldVal, newVal] = diff[key]
    const label = key.replace(/_/g, ' ')
    const oldStr = oldVal === null ? 'none' : String(oldVal)
    const newStr = newVal === null ? 'none' : String(newVal)
    return { summary: `${label}: ${oldStr} → ${newStr}`, fieldCount: 1 }
  }
  return { summary: `${keys.length} fields changed`, fieldCount: keys.length }
}

function RestoreButton({ projectId, rowId }: { projectId: string; rowId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleRestore() {
    if (!confirm('Restore settings to this point? This will overwrite all current settings.')) return
    startTransition(async () => {
      const result = await restoreProjectSettingsAction(projectId, rowId)
      if ('error' in result) {
        alert(`Restore failed: ${result.error}`)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={handleRestore}
      isLoading={isPending}
      disabled={isPending}
    >
      Restore
    </Button>
  )
}

export function HistoryTable({ projectId, rows, nameById }: Props) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No changes recorded yet"
        description="Settings history will appear here after the first save."
        dense
      />
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead>
          <tr
            style={{
              borderBottom: '1px solid var(--c-border)',
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--c-text-dim)',
            }}
          >
            <th style={{ textAlign: 'left', padding: '0 12px 8px 0', whiteSpace: 'nowrap' }}>When</th>
            <th style={{ textAlign: 'left', padding: '0 12px 8px 0' }}>Who</th>
            <th style={{ textAlign: 'left', padding: '0 12px 8px 0' }}>Change</th>
            <th style={{ textAlign: 'left', padding: '0 0 8px' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const { summary } = describeDiff(row.diff)
            const who = row.changedBy ? (nameById[row.changedBy] ?? 'Unknown user') : 'System'
            return (
              <tr
                key={row.id}
                style={{
                  borderTop: i === 0 ? undefined : '1px solid var(--c-border)',
                  verticalAlign: 'top',
                }}
              >
                <td
                  style={{
                    padding: '10px 12px 10px 0',
                    fontSize: 12,
                    color: 'var(--c-text-dim)',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatWhen(row.changedAt)}
                </td>
                <td style={{ padding: '10px 12px 10px 0', fontSize: 13, color: 'var(--c-text)', whiteSpace: 'nowrap' }}>
                  {who}
                </td>
                <td style={{ padding: '10px 12px 10px 0', fontSize: 12, color: 'var(--c-text-mid)', wordBreak: 'break-word' }}>
                  {summary}
                </td>
                <td style={{ padding: '10px 0' }}>
                  <RestoreButton projectId={projectId} rowId={row.id} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
