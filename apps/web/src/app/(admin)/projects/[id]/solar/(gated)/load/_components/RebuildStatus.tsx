'use client'
import type { RebuildState } from '@/lib/solar/load/use-rebuild'

export function RebuildStatus({ state }: { state: RebuildState }) {
  if (state.error) return <p role="alert" style={{ color: '#dc2626', fontSize: 13, margin: '6px 0' }}>{state.error}</p>
  if (!state.message) return null
  return (
    <p role="status" aria-live="polite" style={{ fontSize: 13, color: 'var(--c-text-mid)', margin: '6px 0' }}>
      {state.running && <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, marginRight: 6, border: '2px solid var(--c-amber)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
      {state.message}
    </p>
  )
}
