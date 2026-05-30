'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { setActiveOrganisation } from '@/actions/active-organisation.actions'

interface OrgMembership {
  organisation_id: string
  organisation_name: string
  role: string
  is_active_context: boolean
}

interface Props {
  memberships: OrgMembership[]
}

const ROLE_LABEL: Record<string, string> = {
  owner:           'Owner',
  admin:           'Admin',
  project_manager: 'PM',
  contractor:      'Contractor',
  inspector:       'Inspector',
  supplier:        'Supplier',
  client_viewer:   'Client',
}

export function OrgSwitcher({ memberships }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const current = memberships.find((m) => m.is_active_context) ?? memberships[0] ?? null

  // Close on outside click — declared unconditionally (rules-of-hooks).
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Single-org users: render static label, no dropdown.
  if (memberships.length <= 1) {
    return current ? (
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
        {current.organisation_name}
      </div>
    ) : null
  }

  function pick(orgId: string) {
    if (orgId === current?.organisation_id) {
      setOpen(false)
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await setActiveOrganisation(orgId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        style={{
          background: 'transparent', border: '1px solid var(--c-border)',
          borderRadius: 6, padding: '6px 10px',
          fontSize: 13, fontWeight: 600, color: 'var(--c-text)',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        {current?.organisation_name ?? '—'}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--c-text-dim)' }}>▼</span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 240,
            background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 50,
          }}
        >
          {memberships.map((m) => (
            <button
              key={m.organisation_id}
              type="button"
              onClick={() => pick(m.organisation_id)}
              disabled={isPending}
              style={{
                width: '100%', textAlign: 'left',
                background: m.is_active_context ? 'var(--c-elevated)' : 'transparent',
                border: 'none', cursor: 'pointer', padding: '10px 12px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                fontSize: 13, color: 'var(--c-text)',
              }}
            >
              <span style={{ fontWeight: m.is_active_context ? 600 : 500 }}>
                {m.organisation_name}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                {ROLE_LABEL[m.role] ?? m.role}
                {m.is_active_context ? ' · current' : ''}
              </span>
            </button>
          ))}
          {error && (
            <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--c-danger)' }}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
