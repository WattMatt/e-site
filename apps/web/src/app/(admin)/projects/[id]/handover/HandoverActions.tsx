'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Item {
  id: string
  item: string
  is_complete: boolean
  completed_at: string | null
  completed_by: string | null
}

interface Props {
  projectId: string
  orgId: string
  userId: string
  items: Item[]
}

export function HandoverActions({ projectId, orgId, userId, items }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [newItem, setNewItem] = useState('')
  const [adding, setAdding] = useState(false)

  async function addItem(e: React.FormEvent) {
    e.preventDefault()
    if (!newItem.trim()) return
    const client = createClient()
    const maxOrder = items.reduce((m, i) => Math.max(m, (i as any).sort_order ?? 0), 0)
    await client.schema('projects').from('handover_checklist').insert({
      project_id: projectId,
      organisation_id: orgId,
      item: newItem.trim(),
      sort_order: maxOrder + 1,
    })
    setNewItem('')
    setAdding(false)
    startTransition(() => router.refresh())
  }

  async function toggle(item: Item) {
    const client = createClient()
    await client.schema('projects').from('handover_checklist')
      .update({
        is_complete: !item.is_complete,
        completed_by: !item.is_complete ? userId : null,
        completed_at: !item.is_complete ? new Date().toISOString() : null,
      })
      .eq('id', item.id)
    startTransition(() => router.refresh())
  }

  async function deleteItem(id: string) {
    const client = createClient()
    await client.schema('projects').from('handover_checklist').delete().eq('id', id)
    startTransition(() => router.refresh())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map(item => (
        <div
          key={item.id}
          className="handover-row"
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '8px 4px',
            borderRadius: 6,
          }}
        >
          <button
            type="button"
            onClick={() => toggle(item)}
            disabled={isPending}
            aria-label={item.is_complete ? 'Mark incomplete' : 'Mark complete'}
            style={{
              width: 20, height: 20, flexShrink: 0,
              borderRadius: 4,
              border: `2px solid ${item.is_complete ? '#22c55e' : 'var(--c-border)'}`,
              background: item.is_complete ? '#22c55e' : 'transparent',
              cursor: isPending ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0,
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            {item.is_complete && (
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
          <span
            style={{
              flex: 1, fontSize: 13, lineHeight: 1.5,
              textDecoration: item.is_complete ? 'line-through' : 'none',
              color: item.is_complete ? 'var(--c-text-dim)' : 'var(--c-text)',
            }}
          >
            {item.item}
          </span>
          <button
            type="button"
            onClick={() => deleteItem(item.id)}
            aria-label="Remove item"
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--c-text-dim)', cursor: 'pointer',
              fontSize: 14, padding: '2px 6px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-red)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-dim)' }}
          >
            ✕
          </button>
        </div>
      ))}

      {adding ? (
        <form onSubmit={addItem} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            type="text"
            value={newItem}
            onChange={e => setNewItem(e.target.value)}
            placeholder="New checklist item…"
            autoFocus
            className="ob-input"
            style={{ flex: 1 }}
          />
          <button
            type="submit"
            disabled={!newItem.trim() || isPending}
            className="btn-primary-amber"
            style={{ padding: '7px 14px' }}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="btn-primary-amber"
            style={{
              padding: '7px 14px',
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)',
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          style={{
            marginTop: 10,
            background: 'transparent', border: 'none',
            color: 'var(--c-amber)', fontSize: 13,
            cursor: 'pointer', padding: '6px 4px',
            textAlign: 'left', alignSelf: 'flex-start',
          }}
        >
          + Add item
        </button>
      )}
    </div>
  )
}
