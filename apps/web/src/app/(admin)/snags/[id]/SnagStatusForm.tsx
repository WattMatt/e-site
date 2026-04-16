'use client'

import { useState, useTransition } from 'react'
import { updateSnagStatusAction, signOffSnagAction } from '@/actions/snag.actions'
import { Button } from '@/components/ui/Button'

const STATUSES = [
  { value: 'open', label: 'Open', colour: 'text-red-400 border-red-700' },
  { value: 'in_progress', label: 'In Progress', colour: 'text-amber-400 border-amber-700' },
  { value: 'resolved', label: 'Resolved', colour: 'text-blue-400 border-blue-700' },
  { value: 'pending_sign_off', label: 'Pending Sign-off', colour: 'text-purple-400 border-purple-700' },
  { value: 'signed_off', label: 'Signed Off', colour: 'text-emerald-400 border-emerald-700' },
  { value: 'closed', label: 'Closed', colour: 'text-slate-400 border-slate-600' },
]

interface Props { snagId: string; currentStatus: string; projectId: string }

export function SnagStatusForm({ snagId, currentStatus, projectId }: Props) {
  const [selected, setSelected] = useState(currentStatus)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save() {
    if (selected === currentStatus) return
    setError(null)
    startTransition(async () => {
      // sign_off path: validate closeout photo first
      const result = selected === 'signed_off'
        ? await signOffSnagAction(snagId, projectId)
        : await updateSnagStatusAction(snagId, selected, projectId)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {STATUSES.map(({ value, label, colour }) => (
          <button
            key={value}
            type="button"
            onClick={() => setSelected(value)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${selected === value ? colour + ' bg-slate-700' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <Button size="sm" onClick={save} isLoading={isPending} disabled={selected === currentStatus}>
        Save Status
      </Button>
    </div>
  )
}
