'use client'
/**
 * Per-project schedule settings (owner decisions Q6 + Q10): how durations are
 * counted (default calendar days) and the workload limit (default 2). Edit
 * only — the toolbar does not render this below Edit.
 */
import { useState } from 'react'
import type { DurationMode } from '@esite/shared'
import type { ScheduleSettingsView } from '@/lib/solar/schedule/types'
import { POPOVER } from './popover-style'

const LIMIT_SENTENCE = 'The workload limit must be a whole number from 1 to 50.'

export interface SettingsMenuProps {
  settings: ScheduleSettingsView
  /** Resolves to an error sentence, or null when saved. */
  onSave: (mode: DurationMode, threshold: number) => Promise<string | null>
}

export function SettingsMenu({ settings, onSave }: SettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<DurationMode>(settings.durationMode)
  const [threshold, setThreshold] = useState(String(settings.workloadThreshold))
  const [msg, setMsg] = useState<string | null>(null)

  function toggle() {
    if (!open) {
      // Re-read the saved values each time the panel opens (they may have been
      // changed by someone else and reloaded since).
      setMode(settings.durationMode)
      setThreshold(String(settings.workloadThreshold))
      setMsg(null)
    }
    setOpen(!open)
  }

  async function save() {
    const n = Number(threshold)
    if (!Number.isInteger(n) || n < 1 || n > 50) { setMsg(LIMIT_SENTENCE); return }
    setMsg((await onSave(mode, n)) ?? 'Settings saved.')
  }

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" aria-expanded={open} onClick={toggle}>Schedule settings</button>
      {open && (
        <div role="dialog" aria-label="Schedule settings" style={{ ...POPOVER, right: 0, width: 320 }}>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontWeight: 600 }}>Count durations in</legend>
            <label style={{ display: 'block' }}><input type="radio" name="schedule-duration-mode" checked={mode === 'calendar'} onChange={() => setMode('calendar')} /> Calendar days</label>
            <label style={{ display: 'block' }}><input type="radio" name="schedule-duration-mode" checked={mode === 'working'} onChange={() => setMode('working')} /> Working days (weekends and SA public holidays excluded)</label>
          </fieldset>
          <label style={{ display: 'block', marginTop: 8 }}>Flag an owner with more than this many tasks at once
            <input type="number" min={1} max={50} step={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} style={{ width: 60, marginLeft: 6 }} />
          </label>
          <button type="button" onClick={() => void save()} style={{ marginTop: 8 }}>Save settings</button>
          {msg && <div role="status">{msg}</div>}
        </div>
      )}
    </div>
  )
}
