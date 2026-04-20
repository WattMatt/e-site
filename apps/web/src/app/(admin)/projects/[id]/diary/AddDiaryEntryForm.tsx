'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { diaryService, ENTRY_TYPE_LABELS } from '@esite/shared'
import type { DiaryEntryType } from '@esite/shared'

const WEATHER_OPTIONS = ['Sunny', 'Cloudy', 'Overcast', 'Light rain', 'Heavy rain', 'Windy', 'Hot']

const ENTRY_TYPE_STYLES: Record<DiaryEntryType, { color: string; bg: string; border: string }> = {
  progress:  { color: '#60a5fa', bg: 'rgba(37,99,235,0.15)', border: '#1d4ed8' },
  safety:    { color: '#f87171', bg: 'rgba(127,29,29,0.25)', border: '#7f1d1d' },
  quality:   { color: '#c084fc', bg: 'rgba(88,28,135,0.2)', border: '#6b21a8' },
  delay:     { color: 'var(--c-amber)', bg: 'var(--c-amber-dim)', border: 'var(--c-amber-mid)' },
  weather:   { color: '#38bdf8', bg: 'rgba(7,89,133,0.2)', border: '#0369a1' },
  workforce: { color: '#34d399', bg: 'rgba(5,150,105,0.15)', border: '#065f46' },
  general:   { color: 'var(--c-text-mid)', bg: 'var(--c-elevated)', border: 'var(--c-border)' },
}

interface Props {
  projectId: string
  orgId: string
  userId: string
}

export function AddDiaryEntryForm({ projectId, orgId, userId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [entryType, setEntryType] = useState<DiaryEntryType>('progress')
  const [progressNotes, setProgressNotes] = useState('')
  const [safetyNotes, setSafetyNotes] = useState('')
  const [delayNotes, setDelayNotes] = useState('')
  const [weather, setWeather] = useState('')
  const [workers, setWorkers] = useState('')
  const [delays, setDelays] = useState('')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!progressNotes.trim()) { setError('Progress notes are required.'); return }
    setError('')
    const client = createClient()
    await diaryService.create(client as any, orgId, userId, {
      projectId,
      entryDate,
      entryType,
      progressNotes: progressNotes.trim(),
      safetyNotes: safetyNotes.trim() || undefined,
      delayNotes: delayNotes.trim() || undefined,
      weather: weather || undefined,
      workersOnSite: workers ? parseInt(workers, 10) : undefined,
      delays: delays.trim() || undefined,
    })
    setProgressNotes('')
    setSafetyNotes('')
    setDelayNotes('')
    setWeather('')
    setWorkers('')
    setDelays('')
    setOpen(false)
    startTransition(() => router.refresh())
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary-amber">
        + Add Entry
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="data-panel" style={{ marginTop: 16 }}>
      <div className="data-panel-header">
        <span className="data-panel-title">New Diary Entry</span>
      </div>
      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <p style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}

        {/* Entry type */}
        <div>
          <label className="ob-label">Entry type</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {(Object.keys(ENTRY_TYPE_LABELS) as DiaryEntryType[]).map((type) => {
              const s = ENTRY_TYPE_STYLES[type]
              const isSelected = entryType === type
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setEntryType(type)}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
                    fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
                    border: `1px solid ${isSelected ? s.border : 'var(--c-border)'}`,
                    background: isSelected ? s.bg : 'var(--c-panel)',
                    color: isSelected ? s.color : 'var(--c-text-dim)',
                    cursor: 'pointer',
                  }}
                >
                  {ENTRY_TYPE_LABELS[type]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Date + workers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label className="ob-label">Date *</label>
            <input
              type="date"
              value={entryDate}
              onChange={e => setEntryDate(e.target.value)}
              required
              className="ob-input"
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <label className="ob-label">Workers on site</label>
            <input
              type="number"
              min="0"
              value={workers}
              onChange={e => setWorkers(e.target.value)}
              placeholder="0"
              className="ob-input"
              style={{ marginTop: 4 }}
            />
          </div>
        </div>

        {/* Weather */}
        <div>
          <label className="ob-label">Weather</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {WEATHER_OPTIONS.map(w => (
              <button
                key={w}
                type="button"
                onClick={() => setWeather(w === weather ? '' : w)}
                style={{
                  fontSize: 11, padding: '4px 12px', borderRadius: 20,
                  fontFamily: 'var(--font-mono)',
                  border: `1px solid ${weather === w ? 'var(--c-amber-mid)' : 'var(--c-border)'}`,
                  background: weather === w ? 'var(--c-amber-dim)' : 'var(--c-panel)',
                  color: weather === w ? 'var(--c-amber)' : 'var(--c-text-dim)',
                  cursor: 'pointer',
                }}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* Progress notes */}
        <div>
          <label className="ob-label">Progress notes *</label>
          <textarea
            value={progressNotes}
            onChange={e => setProgressNotes(e.target.value)}
            rows={4}
            placeholder="Describe work completed today…"
            className="ob-input"
            style={{ marginTop: 4, resize: 'vertical' }}
          />
        </div>

        {/* Safety notes */}
        {(entryType === 'safety' || entryType === 'general') && (
          <div>
            <label className="ob-label" style={{ color: '#f87171' }}>Safety notes</label>
            <textarea
              value={safetyNotes}
              onChange={e => setSafetyNotes(e.target.value)}
              rows={2}
              placeholder="Safety observations, near-misses, incidents…"
              className="ob-input"
              style={{ marginTop: 4, resize: 'vertical', borderColor: '#7f1d1d' }}
            />
          </div>
        )}

        {/* Delay notes */}
        {(entryType === 'delay' || entryType === 'general') && (
          <div>
            <label className="ob-label" style={{ color: 'var(--c-amber)' }}>Delay notes</label>
            <textarea
              value={delayNotes}
              onChange={e => setDelayNotes(e.target.value)}
              rows={2}
              placeholder="Cause of delay, estimated impact…"
              className="ob-input"
              style={{ marginTop: 4, resize: 'vertical', borderColor: 'var(--c-amber-mid)' }}
            />
          </div>
        )}

        {/* Generic delays */}
        {entryType !== 'delay' && entryType !== 'safety' && (
          <div>
            <label className="ob-label">Delays / issues</label>
            <textarea
              value={delays}
              onChange={e => setDelays(e.target.value)}
              rows={2}
              placeholder="Any delays, blockers, or issues…"
              className="ob-input"
              style={{ marginTop: 4, resize: 'vertical' }}
            />
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="submit"
            disabled={isPending}
            className="btn-primary-amber"
            style={{ flex: 1, opacity: isPending ? 0.6 : 1 }}
          >
            {isPending ? 'Saving…' : 'Save Entry'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: '1px solid var(--c-border)',
              background: 'var(--c-panel)',
              color: 'var(--c-text-dim)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  )
}
