'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ContractorCompany } from '@esite/shared'

import { Button } from '@/components/ui/Button'
import {
  addContractorCompany,
  renameContractorCompany,
  setContractorCompanyActive,
} from '@/actions/contractor-companies.actions'

interface Props {
  initialCompanies: ContractorCompany[]
}

export function ContractorCompaniesPanel({ initialCompanies }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [addName, setAddName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const name = addName.trim()
    if (!name) return
    startTransition(async () => {
      const result = await addContractorCompany(name)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAddName('')
      router.refresh()
    })
  }

  function handleSaveEdit(id: string) {
    setError(null)
    const name = editName.trim()
    if (!name) return
    startTransition(async () => {
      const result = await renameContractorCompany(id, name)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setEditingId(null)
      router.refresh()
    })
  }

  function handleToggleActive(c: ContractorCompany) {
    const verb = c.active ? 'Deactivate' : 'Reactivate'
    if (!confirm(`${verb} "${c.name}"? Members stay on their projects — this is just a label change.`)) return
    setError(null)
    startTransition(async () => {
      const result = await setContractorCompanyActive(c.id, !c.active)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <form
        onSubmit={handleAdd}
        style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}
      >
        <div style={{ flex: '1 1 240px' }}>
          <label
            htmlFor="new-contractor-name"
            style={{
              display: 'block',
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--c-text-dim)', letterSpacing: '0.08em',
              textTransform: 'uppercase', marginBottom: 4,
            }}
          >
            Company name
          </label>
          <input
            id="new-contractor-name"
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="e.g. Bob's Building"
            disabled={isPending}
            style={{
              width: '100%', padding: '8px 10px',
              fontSize: 13, fontFamily: 'var(--font-sans)',
              border: '1px solid var(--c-border)', borderRadius: 4,
              background: 'var(--c-input-bg)', color: 'var(--c-text)',
            }}
          />
        </div>
        <Button type="submit" disabled={isPending || !addName.trim()}>
          + Add company
        </Button>
      </form>

      {error && (
        <div style={{
          padding: '8px 12px', fontSize: 12, color: 'var(--c-danger)',
          background: 'var(--c-danger-dim)', border: '1px solid var(--c-danger)', borderRadius: 4,
        }}>
          {error}
        </div>
      )}

      {initialCompanies.length === 0 ? (
        <div style={{
          padding: '20px 14px', fontSize: 12, color: 'var(--c-text-dim)',
          fontFamily: 'var(--font-mono)', textAlign: 'center',
        }}>
          No contractor companies yet. Add one above to group external site agents.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {initialCompanies.map((c) => (
            <div
              key={c.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px',
                background: 'var(--c-elevated)',
                border: '1px solid var(--c-border)', borderRadius: 4,
                opacity: c.active ? 1 : 0.55,
              }}
            >
              {editingId === c.id ? (
                <>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    disabled={isPending}
                    autoFocus
                    style={{
                      flex: 1, padding: '6px 8px', fontSize: 13,
                      border: '1px solid var(--c-amber)', borderRadius: 3,
                      background: 'var(--c-input-bg)', color: 'var(--c-text)',
                    }}
                  />
                  <Button onClick={() => handleSaveEdit(c.id)} disabled={isPending || !editName.trim()}>
                    Save
                  </Button>
                  <Button onClick={() => setEditingId(null)} disabled={isPending} variant="ghost">
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                    {c.name}
                  </span>
                  {!c.active && <span className="badge badge-muted">inactive</span>}
                  <Button
                    onClick={() => { setEditingId(c.id); setEditName(c.name) }}
                    disabled={isPending}
                    variant="ghost"
                  >
                    Rename
                  </Button>
                  <Button onClick={() => handleToggleActive(c)} disabled={isPending} variant="ghost">
                    {c.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
