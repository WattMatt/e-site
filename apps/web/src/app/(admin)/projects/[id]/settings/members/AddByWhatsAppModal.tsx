// apps/web/src/app/(admin)/projects/[id]/settings/members/AddByWhatsAppModal.tsx
'use client'
import { useState, useTransition } from 'react'
import { inviteWhatsAppExternalAction } from '@/actions/whatsapp-invite.actions'
import { addProjectMember } from '@/actions/project-members.actions'

interface Props { projectId: string; open: boolean; onClose: () => void }

export function AddByWhatsAppModal({ projectId, open, onClose }: Props) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [existing, setExisting] = useState<{ userId: string; name: string | null } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (!open) return null

  const submit = () => start(async () => {
    const r = await inviteWhatsAppExternalAction({ projectId, fullName, phone, company: company || undefined })
    if ('existing' in r) { setExisting(r.existing); return }
    if ('error' in r) { setMsg(r.error); return }
    setMsg('Invitation sent. They appear as "Awaiting WhatsApp opt-in" until they tap Yes.')
  })
  const addExisting = () => start(async () => {
    const r = await addProjectMember(projectId, existing!.userId, 'contractor')
    setMsg(r && 'error' in r && r.error ? String(r.error) : `${existing!.name ?? 'They'} were added to this project.`)
    setExisting(null)
  })

  return (
    <div role="dialog" aria-label="Add by WhatsApp" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 8, padding: 20, width: 'min(440px, 92vw)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Add by WhatsApp</h2>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-dim)' }}>
          For site people without an E-Site login. They get a WhatsApp invitation and nothing else until they accept it.
        </p>
        <label style={{ fontSize: 12 }}>Name<input value={fullName} onChange={(e) => setFullName(e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
        <label style={{ fontSize: 12 }}>WhatsApp number<input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="082 123 4567" style={{ display: 'block', width: '100%' }} /></label>
        <label style={{ fontSize: 12 }}>Company (optional)<input value={company} onChange={(e) => setCompany(e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
        {existing && (
          <div style={{ fontSize: 12 }}>
            That number already belongs to <strong>{existing.name ?? 'an E-Site user'}</strong>.{' '}
            <button type="button" disabled={pending} onClick={addExisting}>Add them to this project</button>
          </div>
        )}
        {msg && <p style={{ margin: 0, fontSize: 12 }}>{msg}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" disabled={pending || !fullName || !phone} onClick={submit}>Send invitation</button>
        </div>
      </div>
    </div>
  )
}
