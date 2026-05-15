'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createHandoverSubfolderAction } from '@/actions/handover.actions'
import { Button } from '@/components/ui/Button'

export function HandoverNewFolderForm({
  projectId,
  parentFolderId,
}: {
  projectId: string
  parentFolderId: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    startTransition(async () => {
      const res = await createHandoverSubfolderAction(projectId, parentFolderId, name)
      if ('error' in res) {
        setErr(res.error)
        return
      }
      setName('')
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        + New folder
      </Button>
    )
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <input
        autoFocus
        className="ob-input"
        type="text"
        placeholder="Folder name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ padding: '6px 8px', fontSize: 13, width: 180 }}
        disabled={pending}
      />
      <Button type="submit" variant="primary" size="sm" disabled={!name.trim() || pending} isLoading={pending}>
        Create
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(false)
          setName('')
          setErr(null)
        }}
        disabled={pending}
      >
        Cancel
      </Button>
      {err && <span style={{ fontSize: 11, color: 'var(--c-red, #dc2626)' }}>{err}</span>}
    </form>
  )
}
