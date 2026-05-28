'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ContractorCompany } from '@esite/shared'

import { setUserContractorCompany } from '@/actions/contractor-companies.actions'

interface Props {
  userId: string
  currentCompanyId: string | null
  companies: ContractorCompany[]
  disabled?: boolean
}

/** Compact per-row select for assigning a user to a contractor company. */
export function UserCompanyDropdown({
  userId, currentCompanyId, companies, disabled,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState<string>(currentCompanyId ?? '')

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    setValue(next)
    setError(null)
    startTransition(async () => {
      const result = await setUserContractorCompany(userId, next === '' ? null : next)
      if (!result.ok) {
        setError(result.error)
        setValue(currentCompanyId ?? '')
        return
      }
      router.refresh()
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 140 }}>
      <select
        value={value}
        onChange={handleChange}
        disabled={disabled || isPending}
        style={{
          padding: '4px 6px', fontSize: 11,
          fontFamily: 'var(--font-mono)',
          background: 'var(--c-input-bg)', color: 'var(--c-text)',
          border: '1px solid var(--c-border)', borderRadius: 3,
        }}
      >
        <option value="">— Internal —</option>
        {companies.filter((c) => c.active || c.id === currentCompanyId).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}{!c.active ? ' (inactive)' : ''}
          </option>
        ))}
      </select>
      {error && (
        <span style={{ fontSize: 9, color: 'var(--c-danger)' }}>{error}</span>
      )}
    </div>
  )
}
