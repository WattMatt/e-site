'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  aiSuggestGroupAction, confirmGroupAction, createItemForGroupAction, dismissSuggestionAction, excludeGroupAction,
} from '@/actions/rate-catalogue.actions'
import { zar } from '@/lib/rate-library/format'

export interface QueueItemOption { id: string; code: string; description: string; unit: string }
export interface QueueGroupView {
  groupKey: string; heading: string; description: string; unit: string | null; normalisedUnit: string | null
  status: 'suggested' | 'unmatched' | 'rejected'; lines: number; sources: number
  suggested: QueueItemOption | null; method: string | null; reason: string | null; hint: string | null; sampleRate: number | null
}

const CATEGORIES = ['other', 'mv_switchgear', 'light_fitting', 'earthing', 'testing_commissioning', 'civil', 'preliminaries'] as const

/** One group of identical lines in the review queue. Nothing here confirms without a person pressing a button. */
export function QueueGroupCard({ g, items, ai }: { g: QueueGroupView; items: QueueItemOption[]; ai: { available: boolean; reason: string | null } }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [mode, setMode] = useState<'none' | 'pick' | 'create'>('none')
  const [search, setSearch] = useState('')
  const [pick, setPick] = useState('')
  const [desc, setDesc] = useState(g.description)
  const [cat, setCat] = useState<string>('other')
  const sameUnit = useMemo(() => items.filter(i => i.unit === g.normalisedUnit), [items, g.normalisedUnit])
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (q ? sameUnit.filter(i => `${i.description} ${i.code}`.toLowerCase().includes(q)) : sameUnit).slice(0, 50)
  }, [sameUnit, search])

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => {
    const r = await fn()
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'Failed' }); return }
    setMsg({ ok: true, text: done })
    router.refresh()
  })
  const box = { padding: '6px 8px', border: '1px solid var(--c-border)', borderRadius: 6, background: 'var(--c-base)', color: 'inherit', minWidth: 0 }

  return (
    <div style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 12, display: 'grid', gap: 8, background: 'var(--c-panel)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>{g.heading || '—'}</div>
          <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{g.description}</div>
          <div style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>
            per {g.unit ?? '—'} · {g.lines} line(s) in {g.sources} document(s){g.sampleRate ? ` · e.g. ${zar(g.sampleRate)}` : ''}
            {g.hint ? ` · ${g.hint}` : ''}
          </div>
        </div>
        <span style={{ fontSize: 12, alignSelf: 'start', padding: '2px 8px', borderRadius: 10, border: '1px solid var(--c-border)' }}>
          {g.status === 'suggested' ? `suggested (${g.method === 'ai' ? 'AI' : 'rules'})` : g.status === 'rejected' ? 'suggestion dismissed' : 'unmatched'}
        </span>
      </div>

      {g.status === 'suggested' && g.suggested ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>→ <strong>{g.suggested.description}</strong> <span style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>{g.suggested.code}</span></span>
          {g.reason ? <span style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>“{g.reason}”</span> : null}
          <button type="button" disabled={pending} onClick={() => run(() => confirmGroupAction(g.groupKey, g.suggested!.id), 'Confirmed')}>Confirm</button>
          <button type="button" disabled={pending} onClick={() => run(() => dismissSuggestionAction(g.groupKey), 'Suggestion dismissed')}>Dismiss</button>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={pending} onClick={() => setMode(mode === 'pick' ? 'none' : 'pick')}>Assign to item…</button>
        <button type="button" disabled={pending} onClick={() => setMode(mode === 'create' ? 'none' : 'create')}>New item…</button>
        <button type="button" disabled={pending} onClick={() => run(() => excludeGroupAction(g.groupKey), 'Marked as not a rate')}>Not a rate</button>
        {g.status !== 'suggested' ? (
          <button type="button" disabled={pending || !ai.available} title={ai.reason ?? undefined}
            onClick={() => start(async () => {
              const r = await aiSuggestGroupAction(g.groupKey)
              if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
              setMsg({ ok: true, text: r.data.itemId ? 'AI suggestion added — confirm or dismiss it' : `No AI match: ${r.data.reason}` })
              router.refresh()
            })}>Suggest with AI</button>
        ) : null}
      </div>
      {!ai.available && g.status !== 'suggested' ? <div style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>{ai.reason}</div> : null}

      {mode === 'pick' ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <input aria-label="Search catalogue" placeholder={`Search ${sameUnit.length} item(s) priced per ${g.normalisedUnit ?? '—'}`} value={search} onChange={e => setSearch(e.target.value)} style={box} />
          <select aria-label="Catalogue item" value={pick} onChange={e => setPick(e.target.value)} size={Math.min(8, Math.max(2, shown.length))} style={box}>
            {shown.map(i => <option key={i.id} value={i.id}>{i.description} — {i.code}</option>)}
          </select>
          <div><button type="button" disabled={pending || !pick} onClick={() => run(() => confirmGroupAction(g.groupKey, pick), 'Assigned')}>Assign {g.lines} line(s)</button></div>
        </div>
      ) : null}

      {mode === 'create' ? (
        <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>Item description
            <input value={desc} onChange={e => setDesc(e.target.value)} style={box} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>Category
            <select value={cat} onChange={e => setCat(e.target.value)} style={box}>{CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</select>
          </label>
          <div style={{ alignSelf: 'end' }}>
            <button type="button" disabled={pending || desc.trim().length < 3 || !g.normalisedUnit}
              onClick={() => run(() => createItemForGroupAction(g.groupKey, { description: desc, unit: g.normalisedUnit ?? '', category: cat }), 'Item created and lines assigned')}>
              Create item per {g.normalisedUnit ?? '—'}
            </button>
          </div>
        </div>
      ) : null}

      {msg ? <div role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: msg.ok ? 'var(--c-text-dim)' : 'var(--c-red, #c0392b)' }}>{msg.text}</div> : null}
    </div>
  )
}
