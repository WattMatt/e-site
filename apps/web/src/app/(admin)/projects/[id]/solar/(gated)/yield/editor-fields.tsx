'use client'
/** Small labelled inputs shared by the case and financials editors. Numbers are parsed on change; the server validates. */
import { useId, type ReactNode } from 'react'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset aria-label={title} style={{ border: '1px solid var(--c-border, #e5e7eb)', borderRadius: 8, padding: 12, display: 'grid', gap: 8, minWidth: 0 }}>
      <legend style={{ fontWeight: 600 }}>{title}</legend>
      {children}
    </fieldset>
  )
}

/** Accessible name is "<label> (<unit>)" so the unit is always stated (spec §0.4 rule 3). */
export function NumField({ label, unit, value, onChange, disabled, error, step = 'any' }: { label: string; unit: string; value: number | null; onChange: (v: number | null) => void; disabled?: boolean; error?: string; step?: string }) {
  const id = useId()
  return (
    <label htmlFor={id} style={{ display: 'grid', gap: 2 }}>
      <span style={{ fontSize: 12 }}>{unit ? `${label} (${unit})` : label}</span>
      <input id={id} aria-label={`${label}${unit ? ` (${unit})` : ''}`} type="number" step={step} disabled={disabled}
        value={value === null || Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      {error && <span role="alert" style={{ color: 'var(--c-red, #dc2626)', fontSize: 12 }}>{error}</span>}
    </label>
  )
}

export function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <label><input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
}
