'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteDiaryEntryAction } from '@/actions/diary.actions'

interface Props {
  entryId: string
}

/**
 * Two-step inline delete confirm. Safari suppresses window.confirm (see the
 * photo-delete lesson), so the first click arms and a second click within 3s
 * commits. Visibility (author-or-PM) is decided by the parent server component,
 * which only renders this when the viewer may delete the entry.
 */
export function DeleteDiaryEntryButton({ entryId }: Props) {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function arm() {
    setArmed(true)
    setError('')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setArmed(false), 3000)
  }

  async function commit() {
    if (timer.current) clearTimeout(timer.current)
    setBusy(true)
    setError('')
    const res = await deleteDiaryEntryAction(entryId)
    if (res?.error) {
      setError(res.error)
      setBusy(false)
      setArmed(false)
      return
    }
    router.refresh()
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {error && <span style={{ color: 'var(--c-red)', fontSize: 11 }}>{error}</span>}
      <button
        type="button"
        onClick={armed ? commit : arm}
        disabled={busy}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
          textTransform: 'uppercase', cursor: busy ? 'wait' : 'pointer',
          background: armed ? 'var(--c-red)' : 'transparent',
          color: armed ? '#fff' : 'var(--c-red)',
          border: '1px solid var(--c-red)', borderRadius: 6, padding: '3px 8px',
        }}
      >
        {busy ? 'Deleting…' : armed ? 'Confirm delete?' : 'Delete'}
      </button>
    </span>
  )
}
