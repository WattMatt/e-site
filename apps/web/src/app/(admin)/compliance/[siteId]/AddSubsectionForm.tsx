'use client'

import { useState, useRef } from 'react'
import { createSubsectionAction } from '@/actions/compliance.actions'

interface Props {
  siteId: string
}

export function AddSubsectionForm({ siteId }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    const result = await createSubsectionAction(siteId, formData)
    setLoading(false)
    if (result.error) {
      setError(result.error)
    } else {
      formRef.current?.reset()
      setOpen(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm px-3 py-1.5 rounded-lg border border-dashed border-slate-600 text-slate-400 hover:border-slate-400 hover:text-slate-200 transition-colors"
      >
        + Add subsection
      </button>
    )
  }

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-xl p-4">
      <p className="text-sm font-medium text-white mb-4">New subsection</p>
      <form ref={formRef} action={handleSubmit} className="space-y-3">
        {/* Name */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Name <span className="text-red-400">*</span>
          </label>
          <input
            name="name"
            type="text"
            required
            placeholder="e.g. Main Distribution Board"
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* SANS ref + sort order */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">SANS reference</label>
            <input
              name="sans_ref"
              type="text"
              placeholder="e.g. SANS 10142-1"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Sort order</label>
            <input
              name="sort_order"
              type="number"
              min="0"
              defaultValue="0"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">Description</label>
          <input
            name="description"
            type="text"
            placeholder="Optional notes"
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={loading}
            className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
          >
            {loading ? 'Adding…' : 'Add subsection'}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setError(null) }}
            className="text-sm px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
