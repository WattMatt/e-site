'use client'
/** Validate + Publish (spec §12). The database enforces every publish rule (00209). */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { publishTariffYearAction, validateTariffYearAction } from '@/actions/tariff-review.actions'
import { useArmedConfirm } from '@/app/(admin)/projects/[id]/solar/_components/useArmedConfirm'

export function PublishPanel({ yearId, state, validatedAt, blocking, unreviewedInferred }: {
  yearId: string; state: string; validatedAt: string | null; blocking: number | null; unreviewedInferred: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'validate' | 'publish' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const confirmPublish = useArmedConfirm()
  if (state === 'published' || state === 'superseded') {
    return <p style={{ fontSize: 13 }}>This year is {state}: it is read-only. Corrections are a new version through review.</p>
  }
  const ready = validatedAt !== null && blocking === 0 && unreviewedInferred === 0
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p style={{ fontSize: 13, margin: 0 }}>
        {validatedAt === null ? 'Not checked since the last change.' : `Checked: ${blocking ?? '?'} blocking issue(s).`}
        {unreviewedInferred > 0 && ` ${unreviewedInferred} inferred unit(s) still need review.`}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" isLoading={busy === 'validate'} onClick={async () => {
          setBusy('validate'); setMsg(null)
          const r = await validateTariffYearAction({ yearId })
          setBusy(null)
          if ('error' in r) setMsg({ ok: false, text: r.error })
          else { setMsg({ ok: r.blocking === 0, text: `${r.blocking} blocking, ${r.review} to review, ${r.warn} warnings.` }); router.refresh() }
        }}>Run checks</Button>
        <Button disabled={!ready} isLoading={busy === 'publish'} title={ready ? undefined : 'Run the checks with 0 blocking issues and review every inferred unit first'} onClick={async () => {
          // Publishing supersedes the previous year and cannot be undone: two-step (§0.4).
          if (!confirmPublish.armed) return confirmPublish.arm()
          confirmPublish.disarm()
          setBusy('publish'); setMsg(null)
          const r = await publishTariffYearAction({ yearId })
          setBusy(null)
          if ('error' in r) setMsg({ ok: false, text: r.error })
          else { setMsg({ ok: true, text: 'Published. The previous year is now superseded.' }); router.refresh() }
        }}>{confirmPublish.armed ? 'Confirm publish' : 'Publish year'}</Button>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)', margin: 0 }}>{msg.text}</p>}
    </div>
  )
}
