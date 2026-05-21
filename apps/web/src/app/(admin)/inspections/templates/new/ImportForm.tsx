'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { createTemplateAction } from '@/actions/inspections-template.actions'

export default function ImportForm({ organisationId }: { organisationId: string }) {
  const router = useRouter()
  const [json, setJson] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit() {
    setError(null)
    setBusy(true)
    try {
      const id = await createTemplateAction(organisationId, json)
      router.push(`/inspections/templates/${id}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        placeholder='{"template_id": "lv-board-coc", "version": "1.0", "name": "...", ...}'
        style={{
          width: '100%',
          height: 480,
          padding: 14,
          background: 'var(--c-panel)',
          border: '1px solid var(--c-border)',
          borderRadius: 6,
          color: 'var(--c-text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.5,
          resize: 'vertical',
        }}
      />

      {error && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--c-red-dim)',
            border: '1px solid #6b1e1e',
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

      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={onSubmit} disabled={busy || !json.trim()} isLoading={busy}>
          {busy ? 'Importing…' : 'Import'}
        </Button>
        <Button variant="ghost" onClick={() => { setJson(''); setError(null) }} disabled={busy}>
          Clear
        </Button>
      </div>
    </div>
  )
}
