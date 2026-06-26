'use client'

import { useTheme } from '@/components/providers/ThemeProvider'
import type { ThemeMode } from '@/lib/theme/types'

const NEXT: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' }
const ICON: Record<ThemeMode, string> = { light: '☀', dark: '☾', system: '◐' }
const LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' }

export function ThemeToggle() {
  const { mode, setTheme } = useTheme()
  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT[mode])}
      aria-label={`Theme: ${LABEL[mode]}. Click to change.`}
      title={`Theme: ${LABEL[mode]}`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 34, height: 34, borderRadius: 8, cursor: 'pointer',
        background: 'transparent', border: '1px solid var(--c-border)',
        color: 'var(--c-text-mid)', fontSize: 16, lineHeight: 1,
      }}
    >
      <span aria-hidden>{ICON[mode]}</span>
    </button>
  )
}
