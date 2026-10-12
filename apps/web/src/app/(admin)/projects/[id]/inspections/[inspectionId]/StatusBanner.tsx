import type { ReactNode } from 'react'

export interface StatusBannerProps {
  status: string
  assigneeName: string | null
  verifierName: string | null
  /** The signed-in person is the assigned verifier. */
  isVerifier: boolean
  /** The signed-in person may change the inspector and verifier above. */
  canReassign: boolean
  /** The template needs a verifier who did not fill it in (00248). */
  separateVerifier: boolean
  /** The assigned verifier has entered answers, so they can never certify it. */
  verifierHasAnswered: boolean
  completedAt: string | null
  certifiedAt: string | null
  cocNumber: string | null
  reinspectionNotes: string | null
  abandonedReason: string | null
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : null)

/**
 * One plain sentence on where the inspection stands, who it is waiting on and what happens next.
 * Before this the page said only "awaiting verification" on a greyed-out button, so a person who
 * was not the verifier could not tell who was, and nothing warned that a CoC verifier who had
 * filled it in could never certify it (Shoprite, ZZ status-guard test, 2026-10-12).
 */
export function statusMessage(p: StatusBannerProps): { tone: 'info' | 'warn' | 'ok'; text: string } {
  const verifier = p.verifierName ?? 'the verifier'
  const inspector = p.assigneeName
  const blocked = p.separateVerifier && p.verifierHasAnswered
  const fixIt = p.canReassign ? 'Choose a different verifier above.' : 'A project manager must choose a different verifier.'

  switch (p.status) {
    case 'awaiting_verification': {
      const when = fmt(p.completedAt)
      if (blocked) {
        return {
          tone: 'warn',
          text: `${p.isVerifier ? 'You entered' : `${verifier} entered`} answers on this inspection, so ${p.isVerifier ? 'you' : 'they'} cannot certify it: this template needs a separate verifier. ${fixIt}`,
        }
      }
      if (p.isVerifier) {
        return {
          tone: 'warn',
          text: `This inspection is waiting on you${when ? ` (submitted ${when})` : ''}. Check the answers and photos, then use Certify / Send back on the right.`,
        }
      }
      return {
        tone: 'info',
        text: `Submitted${when ? ` ${when}` : ''}. Waiting on ${verifier} to verify: only they can certify it or send it back.${p.canReassign ? ' You can change the verifier above.' : ''}`,
      }
    }
    case 're-inspect_required':
      return {
        tone: 'warn',
        text: `Sent back by ${verifier}${p.reinspectionNotes ? `: “${p.reinspectionNotes}”` : ''}. ${inspector ?? 'The inspector'} should fix this and submit again.`,
      }
    case 'certified':
      return {
        tone: 'ok',
        text: `Certified${fmt(p.certifiedAt) ? ` on ${fmt(p.certifiedAt)}` : ''} by ${verifier}${p.cocNumber ? ` (${p.cocNumber})` : ''}.`,
      }
    case 'abandoned':
      return { tone: 'info', text: `Abandoned${p.abandonedReason ? `: ${p.abandonedReason}` : ''}.` }
    default: {
      if (blocked) {
        return {
          tone: 'warn',
          text: `${verifier} has entered answers on this inspection, so they will not be able to certify it: this template needs a separate verifier. ${fixIt}`,
        }
      }
      const who = inspector ? `${inspector} is the inspector.` : 'No inspector is assigned; anyone on the project can fill it in.'
      const you = p.isVerifier && p.separateVerifier ? ' You are the verifier, so you check it once submitted rather than fill it in.' : ''
      return { tone: 'info', text: `${who} When it is complete, Submit sends it to ${verifier} to verify.${you}` }
    }
  }
}

const TONE: Record<'info' | 'warn' | 'ok', { border: string; bg: string }> = {
  info: { border: 'var(--c-border)', bg: 'var(--c-panel)' },
  warn: { border: 'var(--c-amber)', bg: 'var(--c-amber-dim, var(--c-panel))' },
  ok: { border: 'var(--c-green, #3fb950)', bg: 'var(--c-panel)' },
}

export default function StatusBanner(props: StatusBannerProps): ReactNode {
  const { tone, text } = statusMessage(props)
  return (
    <div
      role="status"
      style={{
        marginBottom: 16,
        padding: '10px 14px',
        borderRadius: 8,
        border: `1px solid ${TONE[tone].border}`,
        background: TONE[tone].bg,
        fontSize: 13,
        color: 'var(--c-text)',
      }}
    >
      {text}
    </div>
  )
}
