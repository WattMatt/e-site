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
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-3 group">
          <button
            onClick={() => toggle(item)}
            disabled={isPending}
            className={`w-5 h-5 rounded border-2 flex-shrink-0 transition-colors flex items-center justify-center ${
              item.is_complete
                ? 'bg-green-600 border-green-600'
                : 'border-slate-500 hover:border-green-500'
            }`}
            aria-label={item.is_complete ? 'Mark incomplete' : 'Mark complete'}
          >
            {item.is_complete && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
          <span className={`flex-1 text-sm ${item.is_complete ? 'line-through text-slate-500' : 'text-slate-200'}`}>
            {item.item}
          </span>
          <button
            onClick={() => deleteItem(item.id)}
            className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all text-xs px-1"
            aria-label="Remove item"
          >
            ✕
          </button>
        </div>
      ))}

      {adding ? (
        <form onSubmit={addItem} className="flex gap-2 mt-3">
          <input
            type="text"
            value={newItem}
            onChange={e => setNewItem(e.target.value)}
            placeholder="New checklist item…"
            autoFocus
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!newItem.trim() || isPending}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold px-4 rounded-lg transition-colors"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="px-3 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg transition-colors"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1.5 mt-2 transition-colors"
        >
          + Add item
        </button>
      )}
    </div>
  )
}
