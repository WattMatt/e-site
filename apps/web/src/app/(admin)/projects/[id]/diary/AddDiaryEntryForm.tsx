'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { diaryService } from '@esite/shared'

const WEATHER_OPTIONS = ['Sunny', 'Cloudy', 'Overcast', 'Light rain', 'Heavy rain', 'Windy', 'Hot']

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
  const [progressNotes, setProgressNotes] = useState('')
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
      progressNotes: progressNotes.trim(),
      weather: weather || undefined,
      workersOnSite: workers ? parseInt(workers, 10) : undefined,
      delays: delays.trim() || undefined,
    })
    setProgressNotes('')
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
