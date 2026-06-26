'use client'

import { useTheme } from '@/components/providers/ThemeProvider'
import { THEME_MODES, type ThemeMode } from '@/lib/theme/types'

const LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' }

export function ThemeSegmentedControl() {
  const { mode, setTheme } = useTheme()
  return (
    <div>
      <label className="ob-label">Appearance</label>
      <div role="radiogroup" aria-label="Appearance" style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 10, background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
        {THEME_MODES.map((m) => {
          const active = mode === m
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(m)}
              style={{
                padding: '6px 14px', borderRadius: 7, cursor: 'pointer', fontSize: 13,
                border: 'none',
                background: active ? 'var(--c-amber-dim)' : 'transparent',
                color: active ? 'var(--c-amber)' : 'var(--c-text-mid)',
                fontWeight: active ? 600 : 400,
              }}
            >
              {LABEL[m]}
            </button>
          )
        })}
      </div>
      <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 6 }}>
        System follows your device’s light/dark setting.
      </p>
    </div>
  )
}
