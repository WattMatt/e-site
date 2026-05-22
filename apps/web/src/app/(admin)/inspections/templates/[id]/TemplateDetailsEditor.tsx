'use client'

import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateTemplateDetailsAction } from '@/actions/inspections-template.actions'

interface Props {
  organisationId: string
  /** The kebab-case family id — name + description apply to every version. */
  templateId: string
  initialName: string
  initialDescription: string | null
  canEdit: boolean
}

export default function TemplateDetailsEditor({
  organisationId,
  templateId,
  initialName,
  initialDescription,
  canEdit,
}: Props) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty = name !== initialName || description !== (initialDescription ?? '')

  async function onSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await updateTemplateDetailsAction(organisationId, templateId, {
        name,
        description: description.trim() || null,
      })
      if (!res.ok) {
        setError(res.error)
      } else {
        setSaved(true)
        router.refresh()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <span className="data-panel-title">Template details</span>
      </CardHeader>
      <CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle}>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setSaved(false)
              }}
              disabled={!canEdit || saving}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle}>Description</span>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                setSaved(false)
              }}
              disabled={!canEdit || saving}
              rows={3}
              placeholder="Optional — what this template is for and when to use it."
              style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }}
            />
          </label>

          {canEdit ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Button onClick={onSave} disabled={!dirty || saving || !name.trim()}>
                {saving ? 'Saving…' : 'Save details'}
              </Button>
              {saved && !dirty && (
                <span style={{ fontSize: 12, color: 'var(--c-green, #16a34a)' }}>Saved</span>
              )}
              <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                Applies to every version of this template.
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
              Only an owner or admin can edit template details.
            </span>
          )}

          {error && (
            <p style={{ fontSize: 12, color: 'var(--c-red, #dc2626)', margin: 0 }}>{error}</p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--c-text-mid)',
}

const inputStyle: CSSProperties = {
  fontSize: 13,
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--c-border)',
  background: 'var(--c-panel)',
  color: 'var(--c-text)',
  fontFamily: 'inherit',
}
