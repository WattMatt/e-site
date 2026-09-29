'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  SOLAR_SETTING_FIELDS, SOLAR_SETTING_SECTIONS, validateSolarOrgSettings, type SolarOrgSettingForm,
} from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormField, TextInput } from '@/components/ui/FormField'
import { saveSolarOrgSettingsAction } from '@/actions/solar-settings.actions'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'

export function SolarSettingsForm({ initial, updatedAt }: { initial: SolarOrgSettingForm; updatedAt: string | null }) {
  const router = useRouter()
  const [baseline, setBaseline] = useState<SolarOrgSettingForm>(initial)
  const [form, setForm] = useState<SolarOrgSettingForm>(initial)
  const [token, setToken] = useState<string | null>(updatedAt)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useSolarDirtyGuard(JSON.stringify(form) !== JSON.stringify(baseline))

  const set = (key: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next })
    setMessage(null)
  }

  async function save() {
    setError(null)
    setMessage(null)
    const check = validateSolarOrgSettings(form)
    if (Object.keys(check.errors).length > 0) { setErrors(check.errors); return }
    setBusy(true)
    const res = await saveSolarOrgSettingsAction({ form, expectedUpdatedAt: token })
    setBusy(false)
    if ('fieldErrors' in res) { setErrors(res.fieldErrors); return }
    if ('error' in res) { setError(res.error); return }
    setToken(res.updatedAt)
    setBaseline(form)
    setMessage('Saved')
    router.refresh()
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {SOLAR_SETTING_SECTIONS.map((section) => (
        <Card key={section.key}>
          <CardHeader><span className="data-panel-title">{section.title}</span></CardHeader>
          <CardBody>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
              {SOLAR_SETTING_FIELDS.filter((f) => f.section === section.key).map((f) => {
                const id = `solar-setting-${f.key}`
                if (f.kind === 'boolean') {
                  return (
                    <label key={f.key} htmlFor={id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                      <input id={id} type="checkbox" checked={form[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} />
                      {f.label}
                    </label>
                  )
                }
                return (
                  <FormField
                    key={f.key}
                    label={f.unit ? `${f.label} (${f.unit})` : f.label}
                    htmlFor={id}
                    error={errors[f.key]}
                    hint={f.source ? `Default decided in ${f.source}` : undefined}
                  >
                    <TextInput id={id} inputMode="decimal" value={String(form[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} invalid={Boolean(errors[f.key])} />
                  </FormField>
                )
              })}
            </div>
          </CardBody>
        </Card>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button type="button" onClick={() => void save()} isLoading={busy}>Save defaults</Button>
        {message && <span role="status" style={{ fontSize: 12, color: 'var(--c-green)' }}>{message}</span>}
        {error && <span role="alert" style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</span>}
      </div>
    </div>
  )
}
