'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { newTemplateVersionAction } from '@/actions/inspections-template.actions'
import MonacoView from '../../MonacoView'

export default function NewVersionForm({
  sourceId,
  organisationId,
  initialJson,
}: {
  sourceId: string
  organisationId: string
  initialJson: string
}) {
  const router = useRouter()
  const [json, setJson] = useState(initialJson)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit() {
    setError(null)
    setBusy(true)
    try {
      let parsed: { version?: string }
      try {
        parsed = JSON.parse(json)
      } catch (e) {
        throw new Error(`Invalid JSON: ${(e as Error).message}`, { cause: e })
      }
      if (!parsed.version) throw new Error('JSON must include a "version" field')

      const newId = await newTemplateVersionAction(
        sourceId,
        organisationId,
        parsed.version,
        json,
      )
      router.push(`/inspections/templates/${newId}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <MonacoView value={json} onChange={setJson} />
      </div>

      {error && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--c-red-dim)',
            border: '1px solid var(--c-red)',
            borderRadius: 6,
            color: 'var(--c-red)',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </div>
      )}

      <div>
        <Button onClick={onSubmit} disabled={busy} isLoading={busy}>
          {busy ? 'Saving…' : 'Save New Version'}
        </Button>
      </div>
    </div>
  )
}
