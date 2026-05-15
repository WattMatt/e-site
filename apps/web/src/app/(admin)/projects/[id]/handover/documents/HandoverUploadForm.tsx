'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { uploadHandoverDocumentAction } from '@/actions/handover.actions'
import { Button } from '@/components/ui/Button'

export function HandoverUploadForm({
  projectId,
  folderId,
}: {
  projectId: string
  folderId: string
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setMsg(null)
    const fd = new FormData()
    fd.set('projectId', projectId)
    fd.set('folderId', folderId)
    fd.set('file', file)
    startTransition(async () => {
      const res = await uploadHandoverDocumentAction(fd)
      if ('error' in res) {
        setMsg(res.error)
        return
      }
      setMsg(res.cloudMirrored ? 'Uploaded ✓ + cloud-mirrored' : 'Uploaded ✓ (local only)')
      if (inputRef.current) inputRef.current.value = ''
      router.refresh()
    })
  }

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <input
        ref={inputRef}
        type="file"
        onChange={onChange}
        disabled={pending}
        style={{ display: 'none' }}
      />
      <Button type="button" variant="primary" size="sm" isLoading={pending}>
        ↥ Upload file
      </Button>
      {msg && <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>{msg}</span>}
    </label>
  )
}
