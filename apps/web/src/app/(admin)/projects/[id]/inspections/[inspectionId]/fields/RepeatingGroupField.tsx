'use client'

import { useState, useMemo } from 'react'
import {
  buildRepeatingGroupKey,
  listRepeatingGroupEntryIndices,
  type Field,
  type Response as InspectionResponse,
} from '@esite/shared'
import type { RendererProps } from '../FieldRenderer'
import FieldRenderer from '../FieldRenderer'
import { deleteRepeatingGroupEntryAction } from '@/actions/inspections.actions'

// Renders a repeating_group: a list of collapsible entry blocks, each one
// hosting the group's sub-fields. Sub-fields are persisted as sibling
// responses with synthetic `field_id` = `<group>[<i>].<sub>` via the
// `onUpsert` escape hatch.
//
// Entry-count lifecycle:
// - On first render, indices are derived from the parent's full response
//   array (`allResponses`) — any synthetic id `<group>[<i>].*` materialises
//   entry `i`. This rehydrates entries when re-opening an in-progress
//   inspection.
// - `+ Add` appends a new index at max+1 and tracks it in local state.
// - `×` (remove) calls `deleteRepeatingGroupEntryAction` (server-side hard
//   delete of every sibling response for that index), then drops the index
//   from local state.
//
// v1 limitations: no drag-reorder; sub-field photos uploaded then orphaned
// by a Remove call are not GC'd here (storage rows linger, harmless because
// the renderer no longer references them).
export default function RepeatingGroupField(p: RendererProps) {
  const { field, inspectionId, sectionId, readOnly, allResponses, onUpsert } = p
  const subFields = field.fields ?? []

  // Seed entry indices from the parent's full response array (when available).
  // CaptureForm wires `allResponses`; previewing or legacy callers that omit
  // it get an empty starting state.
  const initialIndices = useMemo(
    () => (allResponses ? listRepeatingGroupEntryIndices(field.field_id, allResponses) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [field.field_id],
  )
  const [extraIndices, setExtraIndices] = useState<number[]>(initialIndices)
  const [expanded, setExpanded] = useState<Set<number>>(new Set(initialIndices))
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const entries = [...extraIndices].sort((a, b) => a - b)

  const addEntry = () => {
    const next = entries.length === 0 ? 0 : Math.max(...entries) + 1
    setExtraIndices((prev) => [...prev, next])
    setExpanded((prev) => new Set(prev).add(next))
  }

  const removeEntry = async (idx: number) => {
    if (!confirm(`Remove entry ${idx + 1}?`)) return
    setDeletingIdx(idx)
    setError(null)
    try {
      await deleteRepeatingGroupEntryAction({
        inspectionId,
        sectionId,
        groupFieldId: field.field_id,
        index: idx,
      })
      setExtraIndices((prev) => prev.filter((i) => i !== idx))
      setExpanded((prev) => {
        const n = new Set(prev)
        n.delete(idx)
        return n
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDeletingIdx(null)
    }
  }

  const toggleExpand = (idx: number) => {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(idx)) n.delete(idx)
      else n.add(idx)
      return n
    })
  }

  // Lookup function the EntryBlock uses to find the live response for a
  // synthetic field_id. Falls back to undefined when the parent didn't pass
  // allResponses (legacy / preview callers).
  const findSubResponse = (syntheticId: string): InspectionResponse | undefined =>
    allResponses?.find((r) => r.section_id === sectionId && r.field_id === syntheticId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
          {field.label}
          {field.required && <span style={{ color: 'var(--c-red)', marginLeft: 4 }}>*</span>}
        </label>
        {field.help_text && (
          <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>{field.help_text}</p>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map((idx) => (
          <EntryBlock
            key={idx}
            index={idx}
            groupField={field}
            subFields={subFields}
            expanded={expanded.has(idx)}
            onToggle={() => toggleExpand(idx)}
            onRemove={() => removeEntry(idx)}
            removing={deletingIdx === idx}
            readOnly={!!readOnly}
            findResponse={findSubResponse}
            onUpsert={onUpsert}
            parentProps={p}
          />
        ))}
        {entries.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0, fontStyle: 'italic' }}>
            No entries yet.
          </p>
        )}
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={addEntry}
          disabled={field.max_count != null && entries.length >= field.max_count}
          style={{
            alignSelf: 'flex-start',
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px dashed var(--c-border)',
            background: 'transparent',
            color: 'var(--c-text-mid)',
            fontSize: 12,
            cursor:
              field.max_count != null && entries.length >= field.max_count ? 'not-allowed' : 'pointer',
          }}
        >
          + Add {field.label.toLowerCase()}
        </button>
      )}
      {field.max_count != null && entries.length >= field.max_count && (
        <p style={{ fontSize: 11, color: 'var(--c-amber)', margin: 0 }}>
          Maximum {field.max_count} entries reached.
        </p>
      )}
      {error && <p style={{ fontSize: 11, color: 'var(--c-red)', margin: 0 }}>{error}</p>}
    </div>
  )
}

interface EntryBlockProps {
  index: number
  groupField: Field
  subFields: Field[]
  expanded: boolean
  onToggle: () => void
  onRemove: () => void
  removing: boolean
  readOnly: boolean
  findResponse: (syntheticId: string) => InspectionResponse | undefined
  onUpsert?: (fieldId: string, patch: Partial<InspectionResponse>) => void
  parentProps: RendererProps
}

function EntryBlock({
  index,
  groupField,
  subFields,
  expanded,
  onToggle,
  onRemove,
  removing,
  readOnly,
  findResponse,
  onUpsert,
  parentProps,
}: EntryBlockProps) {
  const label = computeEntryLabel(groupField, index, subFields, findResponse)
  return (
    <div
      style={{
        border: '1px solid var(--c-border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          background: 'var(--c-panel-2, var(--c-panel))',
          cursor: 'pointer',
        }}
        onClick={onToggle}
      >
        <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>{expanded ? '▾' : '▸'}</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text)', flex: 1 }}>
          {label}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            disabled={removing}
            title="Remove entry"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--c-red)',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: '2px 6px',
            }}
          >
            {removing ? '…' : '×'}
          </button>
        )}
      </div>
      {expanded && (
        <div
          style={{
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            background: 'var(--c-panel)',
          }}
        >
          {subFields.map((sub) => {
            const syntheticId = buildRepeatingGroupKey(groupField.field_id, index, sub.field_id)
            // We render the sub-field through FieldRenderer, but with a
            // proxy `field` that carries the synthetic field_id. That way
            // PhotoField/SignatureField/FileField (which read field.field_id
            // for storage paths + queries) automatically scope to this entry.
            const subFieldProxy: Field = { ...sub, field_id: syntheticId }
            return (
              <FieldRenderer
                key={syntheticId}
                field={subFieldProxy}
                response={findResponse(syntheticId)}
                inspectionId={parentProps.inspectionId}
                sectionId={parentProps.sectionId}
                readOnly={parentProps.readOnly}
                verifierFlipMode={parentProps.verifierFlipMode}
                onChange={(patch) => {
                  // Route through the parent's onUpsert when available so the
                  // synthetic id lands in the correct response row. Fall back
                  // to the parent's onChange (which would write under the
                  // GROUP id and clobber the group itself) only as a last
                  // resort — should never happen in normal app flow.
                  if (onUpsert) onUpsert(syntheticId, patch)
                  else parentProps.onChange(patch)
                }}
                allResponses={parentProps.allResponses}
                onUpsert={onUpsert}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// Compute the header label for an entry, expanding `{{index}}` and
// `{{<sub_field_id>}}` placeholders against the current sub-field responses.
// Falls back to "Entry N" if no template.
function computeEntryLabel(
  groupField: Field,
  index: number,
  subFields: Field[],
  findResponse: (syntheticId: string) => InspectionResponse | undefined,
): string {
  const template = groupField.item_label_template
  if (!template) return `Entry ${index + 1}`
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
    if (key === 'index') return String(index + 1)
    const sub = subFields.find((s) => s.field_id === key)
    if (!sub) return '—'
    const syntheticId = buildRepeatingGroupKey(groupField.field_id, index, sub.field_id)
    const r = findResponse(syntheticId)
    if (!r) return '—'
    if (r.value_text) return r.value_text.length > 30 ? r.value_text.slice(0, 27) + '…' : r.value_text
    if (r.value_number != null) return String(r.value_number)
    if (r.value_bool != null) return r.value_bool ? '✓' : '✗'
    return '—'
  })
}
