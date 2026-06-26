'use client';

import { useId, useState } from 'react';
import type { Field } from '@esite/shared';
import { FieldTypePicker } from '../FieldTypePicker';
import { FieldEditor } from '../FieldEditor';

// Recursion safety note:
// RepeatingGroupEditor renders FieldEditor for each sub-field. FieldEditor
// dispatches back to RepeatingGroupEditor only for the `repeating_group` type —
// but the FieldTypePicker here always passes disableRepeatingGroup={true}, so
// the schema invariant (single level only) is enforced at the UI layer.
// No depth prop is needed.

interface Props {
  sectionId: string;
  field: Field & { type: 'repeating_group'; fields: Field[] };
  onChange: (patch: Partial<Field>) => void;
  onRemove?: () => void;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function makeSubFieldId(type: Field['type'], existing: Field[]): string {
  const base = type.replace(/-/g, '_');
  const ids = new Set(existing.map((f) => f.field_id));
  let counter = 1;
  while (ids.has(`${base}_${counter}`)) counter++;
  return `${base}_${counter}`;
}

function makeDefaultSubField(type: Field['type'], field_id: string): Field {
  switch (type) {
    case 'pass_fail':   return { field_id, type: 'pass_fail', label: 'New field', required: true };
    case 'number':      return { field_id, type: 'number', label: 'New field', unit: '' };
    case 'text':        return { field_id, type: 'text', label: 'New field' };
    case 'textarea':    return { field_id, type: 'textarea', label: 'New field' };
    case 'date':        return { field_id, type: 'date', label: 'New field' };
    case 'dropdown':    return { field_id, type: 'dropdown', label: 'New field', options: ['Option 1'] };
    case 'multi_select':return { field_id, type: 'multi_select', label: 'New field', options: ['Option 1'] };
    case 'photo':       return { field_id, type: 'photo', label: 'New field' };
    case 'signature':   return { field_id, type: 'signature', label: 'New field', required_qualifications: ['registered_person'] };
    case 'file':        return { field_id, type: 'file', label: 'New file', options: [] };
    case 'computed':    return { field_id, type: 'computed', label: 'New field', formula: 'count_visible_answered' };
    case 'header':      return { field_id, type: 'header', label: 'Section header' };
    case 'repeating_group':
      // Should never reach here — picker disables it. Defensive fallback.
      return { field_id, type: 'text', label: 'New field' };
  }
}

export function RepeatingGroupEditor({ sectionId, field, onChange, onRemove }: Props) {
  const labelId = useId();
  const [showPicker, setShowPicker] = useState(false);
  const [expandedSubFieldId, setExpandedSubFieldId] = useState<string | null>(null);

  const subFields: Field[] = field.fields ?? [];

  function updateSubField(index: number, patch: Partial<Field>) {
    const next = subFields.map((sf, i) => (i === index ? { ...sf, ...patch } : sf));
    onChange({ fields: next });
  }

  function removeSubField(index: number) {
    const next = subFields.filter((_, i) => i !== index);
    onChange({ fields: next });
    if (expandedSubFieldId === subFields[index]?.field_id) {
      setExpandedSubFieldId(null);
    }
  }

  function moveSubField(index: number, direction: 'up' | 'down') {
    const next = [...subFields];
    const swap = direction === 'up' ? index - 1 : index + 1;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    onChange({ fields: next });
  }

  function addSubField(type: Field['type']) {
    const field_id = makeSubFieldId(type, subFields);
    const newField = makeDefaultSubField(type, field_id);
    const next = [...subFields, newField];
    onChange({ fields: next });
    setExpandedSubFieldId(field_id);
  }

  return (
    <div className="space-y-3 p-3 border rounded" style={{ borderColor: 'var(--c-border, #e5e7eb)' }}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--c-text-mid)] uppercase tracking-wide">
          🔁 Repeating group
        </span>
        {onRemove && (
          <button type="button" onClick={onRemove} className="text-xs text-[var(--c-red)] hover:text-[var(--c-red)]">
            Remove
          </button>
        )}
      </div>

      {/* Group label */}
      <input
        id={labelId}
        type="text"
        placeholder="Group label (e.g. Snag list)"
        value={field.label ?? ''}
        onChange={(e) => onChange({ label: e.target.value })}
        className="border rounded px-3 py-2 w-full text-sm"
      />

      {/* Help text */}
      <textarea
        placeholder="Help text (optional)"
        value={field.help_text ?? ''}
        onChange={(e) => onChange({ help_text: e.target.value || undefined })}
        className="border rounded px-3 py-2 w-full text-sm resize-none"
        rows={2}
      />

      {/* Item label template */}
      <input
        type="text"
        placeholder='Entry label template — e.g. "Snag {{index}}: {{description}}" (optional)'
        value={field.item_label_template ?? ''}
        onChange={(e) => onChange({ item_label_template: e.target.value || undefined })}
        className="border rounded px-3 py-2 w-full text-sm"
      />

      {/* Required + entry count limits */}
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={field.required ?? false}
            onChange={(e) => onChange({ required: e.target.checked || undefined })}
          />
          At least one entry required
        </label>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-xs text-[var(--c-text-mid)] block mb-1">Min entries (optional)</label>
          <input
            type="number"
            min={1}
            placeholder="None"
            value={field.min_count ?? ''}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              onChange({ min_count: Number.isFinite(n) && n >= 1 ? n : undefined });
            }}
            className="border rounded px-3 py-1.5 w-full text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-[var(--c-text-mid)] block mb-1">Max entries (optional)</label>
          <input
            type="number"
            min={field.min_count ?? 1}
            placeholder="No limit"
            value={field.max_count ?? ''}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              onChange({ max_count: Number.isFinite(n) && n >= 1 ? n : undefined });
            }}
            className="border rounded px-3 py-1.5 w-full text-sm"
          />
        </div>
      </div>

      {/* Sub-fields section */}
      <div className="border-t pt-3" style={{ borderColor: 'var(--c-border, #e5e7eb)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[var(--c-text-mid)] uppercase tracking-wide">
            Sub-fields ({subFields.length})
          </span>
        </div>

        {subFields.length === 0 && (
          <p className="text-xs text-[var(--c-text-dim)] mb-2">No sub-fields yet. Add at least one.</p>
        )}

        <div className="space-y-1">
          {subFields.map((sf, i) => {
            const isExpanded = expandedSubFieldId === sf.field_id;
            return (
              <div
                key={sf.field_id}
                className="border rounded overflow-hidden"
                style={{ borderColor: 'var(--c-border, #e5e7eb)' }}
              >
                {/* Compact row */}
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-[var(--c-elevated)]"
                  onClick={() => setExpandedSubFieldId(isExpanded ? null : sf.field_id)}
                >
                  <span className="text-xs text-[var(--c-text-dim)] w-5 shrink-0">{i + 1}.</span>
                  <span className="flex-1 text-sm truncate">{sf.label || <em className="text-[var(--c-text-dim)]">Unlabelled</em>}</span>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--c-surface-2, #f3f4f6)', color: 'var(--c-text-dim, #6b7280)' }}
                  >
                    {sf.type}
                  </span>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => moveSubField(i, 'up')}
                      className="text-xs px-1 py-0.5 rounded hover:bg-[var(--c-elevated)] disabled:opacity-30"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === subFields.length - 1}
                      onClick={() => moveSubField(i, 'down')}
                      className="text-xs px-1 py-0.5 rounded hover:bg-[var(--c-elevated)] disabled:opacity-30"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSubField(i)}
                      className="text-xs px-1 py-0.5 rounded text-[var(--c-red)] hover:bg-[var(--c-red-dim)]"
                      title="Remove sub-field"
                    >
                      ✕
                    </button>
                  </div>
                  <span className="text-xs text-[var(--c-text-dim)]">{isExpanded ? '▲' : '▼'}</span>
                </div>

                {/* Inline edit panel */}
                {isExpanded && (
                  <div className="px-3 pb-3 border-t" style={{ borderColor: 'var(--c-border, #e5e7eb)' }}>
                    <div className="pt-2">
                      <FieldEditor
                        sectionId={sectionId}
                        field={sf}
                        sectionFields={subFields}
                        onChange={(patch) => updateSubField(i, patch)}
                        // No onRemove here — remove is handled by the compact row's ✕ button above.
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add sub-field button */}
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="mt-2 flex items-center gap-1.5 text-sm px-3 py-1.5 rounded border border-dashed hover:border-[var(--c-blue)] hover:text-[var(--c-blue)] transition-colors"
          style={{ borderColor: 'var(--c-border, #e5e7eb)', color: 'var(--c-text-dim, #6b7280)' }}
        >
          <span>+</span>
          <span>Add sub-field</span>
        </button>
      </div>

      {/* Field type picker — repeating_group disabled (schema forbids nesting) */}
      {showPicker && (
        <FieldTypePicker
          disableRepeatingGroup={true}
          onSelect={addSubField}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
