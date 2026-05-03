'use client'

import { useEffect, useState } from 'react'
import {
  evaluatePassword,
  strengthLabel,
  strengthColor,
  type PasswordEvaluation,
} from '@/lib/password-strength'

const DEBOUNCE_MS = 300

export function PasswordStrengthMeter({
  password,
  onChange,
}: {
  password: string
  /** Reports the evaluation upward so the parent can block weak/pwned submits. */
  onChange?: (e: PasswordEvaluation | null) => void
}) {
  const [evalResult, setEvalResult] = useState<PasswordEvaluation | null>(null)

  useEffect(() => {
    if (!password) {
      setEvalResult(null)
      onChange?.(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      const r = await evaluatePassword(password)
      if (cancelled) return
      setEvalResult(r)
      onChange?.(r)
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [password, onChange])

  if (!password) return null
  if (!evalResult) {
    return <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 6 }}>Checking…</p>
  }

  const color = strengthColor(evalResult.score)
  const label = strengthLabel(evalResult.score)

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: i <= evalResult.score ? color : 'var(--c-border)',
              transition: 'background 0.18s',
            }}
          />
        ))}
      </div>
      <p style={{ fontSize: 11, color, fontWeight: 600, margin: 0 }}>{label}</p>
      {evalResult.pwned && (
        <p style={{ fontSize: 11, color: 'var(--c-red)', margin: '4px 0 0' }}>
          This password has appeared in {evalResult.pwnCount?.toLocaleString()} known
          breaches. Choose a different one.
        </p>
      )}
      {!evalResult.pwned && evalResult.warning && (
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: '4px 0 0' }}>
          {evalResult.warning}
        </p>
      )}
      {evalResult.suggestions.length > 0 && evalResult.score < 3 && (
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: '4px 0 0' }}>
          {evalResult.suggestions[0]}
        </p>
      )}
    </div>
  )
}
