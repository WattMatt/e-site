'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { diaryService, ENTRY_TYPE_LABELS } from '@esite/shared'
import type { DiaryEntryType } from '@esite/shared'

const WEATHER_OPTIONS = ['Sunny', 'Cloudy', 'Overcast', 'Light rain', 'Heavy rain', 'Windy', 'Hot']

const ENTRY_TYPE_COLOURS: Record<DiaryEntryType, string> = {
  progress: 'bg-blue-600 border-blue-500 text-white',
  safety: 'bg-red-700 border-red-600 text-white',
  quality: 'bg-purple-700 border-purple-600 text-white',
  delay: 'bg-amber-700 border-amber-600 text-white',
  weather: 'bg-sky-700 border-sky-600 text-white',
  workforce: 'bg-emerald-700 border-emerald-600 text-white',
  general: 'bg-slate-600 border-slate-500 text-white',
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
      <button
        onClick={() => setOpen(true)}
        className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
      >
        + Add Entry
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white">New Diary Entry</h3>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Entry type */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Entry type</label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ENTRY_TYPE_LABELS) as DiaryEntryType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setEntryType(type)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                entryType === type
                  ? ENTRY_TYPE_COLOURS[type]
                  : 'border-slate-600 text-slate-400 hover:border-slate-500'
              }`}
            >
              {ENTRY_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Date *</label>
          <input
            type="date"
            value={entryDate}
            onChange={e => setEntryDate(e.target.value)}
            required
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Workers on site</label>
          <input
            type="number"
            min="0"
            value={workers}
            onChange={e => setWorkers(e.target.value)}
            placeholder="0"
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Weather</label>
        <div className="flex flex-wrap gap-2">
          {WEATHER_OPTIONS.map(w => (
            <button
              key={w}
              type="button"
              onClick={() => setWeather(w === weather ? '' : w)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                weather === w
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'border-slate-600 text-slate-400 hover:border-slate-500'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Progress notes *</label>
        <textarea
          value={progressNotes}
          onChange={e => setProgressNotes(e.target.value)}
          rows={4}
          placeholder="Describe work completed today…"
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>

      {(entryType === 'safety' || entryType === 'general') && (
        <div>
          <label className="block text-xs text-red-400 mb-1.5">Safety notes</label>
          <textarea
            value={safetyNotes}
            onChange={e => setSafetyNotes(e.target.value)}
            rows={2}
            placeholder="Safety observations, near-misses, incidents…"
            className="w-full bg-slate-700 border border-red-800/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500 resize-none"
          />
        </div>
      )}

      {(entryType === 'delay' || entryType === 'general') && (
        <div>
          <label className="block text-xs text-amber-400 mb-1.5">Delay notes</label>
          <textarea
            value={delayNotes}
            onChange={e => setDelayNotes(e.target.value)}
            rows={2}
            placeholder="Cause of delay, estimated impact…"
            className="w-full bg-slate-700 border border-amber-800/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 resize-none"
          />
        </div>
      )}

      {entryType !== 'delay' && entryType !== 'safety' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Delays / issues</label>
          <textarea
            value={delays}
            onChange={e => setDelays(e.target.value)}
            rows={2}
            placeholder="Any delays, blockers, or issues…"
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 resize-none"
          />
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
        >
          {isPending ? 'Saving…' : 'Save Entry'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-4 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm py-2 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
