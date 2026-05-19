'use client';
import { useState } from 'react';
import type { TemplateDraft } from './useBuilderState';
import type { useBuilderState } from './useBuilderState';
import type { Field } from '@esite/shared';
import { FieldTypePicker } from './FieldTypePicker';
import { FieldEditor } from './FieldEditor';

type Section = TemplateDraft['sections'][number];
type SectionField = Section['fields'][number];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Generate a unique field_id within the section's existing fields. */
function makeFieldId(type: Field['type'], existingFields: SectionField[]): string {
  const base = type.replace(/-/g, '_'); // repeating_group → repeating_group already snake_case
  const existing = new Set(existingFields.map((f) => f.field_id));
  let counter = 1;
  while (existing.has(`${base}_${counter}`)) counter++;
  return `${base}_${counter}`;
}

/** Create a minimal valid field for a given type. */
function makeDefaultField(type: Field['type'], field_id: string): SectionField {
  switch (type) {
    case 'pass_fail':
      return { field_id, type: 'pass_fail', label: 'New field', required: true };
    case 'number':
      return { field_id, type: 'number', label: 'New field', unit: '' };
    case 'text':
      return { field_id, type: 'text', label: 'New field' };
    case 'textarea':
      return { field_id, type: 'textarea', label: 'New field' };
    case 'date':
      return { field_id, type: 'date', label: 'New field' };
    case 'dropdown':
      return { field_id, type: 'dropdown', label: 'New field', options: ['Option 1'] };
    case 'multi_select':
      return { field_id, type: 'multi_select', label: 'New field', options: ['Option 1'] };
    case 'photo':
      return { field_id, type: 'photo', label: 'New field' };
    case 'signature':
      return { field_id, type: 'signature', label: 'New field', required_qualifications: ['registered_person'] };
    case 'file':
      return { field_id, type: 'file', label: 'New file', options: [] };
    case 'computed':
      return { field_id, type: 'computed', label: 'New field', formula: 'count_visible_answered' };
    case 'header':
      return { field_id, type: 'header', label: 'Section header' };
    case 'repeating_group':
      // repeating_group requires non-empty fields[] — seed with one text sub-field.
      return {
        field_id,
        type: 'repeating_group',
        label: 'New group',
        fields: [{ field_id: 'item_description', type: 'text', label: 'Description' }],
      };
  }
}

interface Props {
  sections: Section[];
  selectedSectionId: string | null;
  builder: Pick<
    ReturnType<typeof useBuilderState>,
    'updateSection' | 'addField' | 'removeField' | 'moveField' | 'updateField'
  >;
}

export function SectionEditor({ sections, selectedSectionId, builder }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);

  const section = sections.find((s) => s.section_id === selectedSectionId) ?? null;

  if (!section) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <p className="text-sm text-center" style={{ color: 'var(--c-text-dim, #6b7280)' }}>
          Select a section to edit it, or add a new one.
        </p>
      </div>
    );
  }

  const selectedField = section.fields.find((f) => f.field_id === selectedFieldId) ?? null;

  function handleFieldTypeChosen(type: Field['type']) {
    const field_id = makeFieldId(type, section!.fields);
    const newField = makeDefaultField(type, field_id);
    builder.addField(section!.section_id, newField as SectionField);
    setSelectedFieldId(field_id);
  }

  function handleFieldChange(fieldId: string, patch: Partial<Field>) {
    builder.updateField(section!.section_id, fieldId, patch as Record<string, unknown>);
  }

  function handleFieldRemove(fieldId: string) {
    if (confirm(`Remove field "${fieldId}"?`)) {
      builder.removeField(section!.section_id, fieldId);
      if (selectedFieldId === fieldId) setSelectedFieldId(null);
    }
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Section title */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-text-dim, #6b7280)' }}>
          Section title
        </label>
        <input
          type="text"
          value={section.title}
          onChange={(e) => builder.updateSection(section.section_id, { title: e.target.value })}
          className="border rounded px-3 py-2 text-sm w-full"
          placeholder="e.g. Site Identification"
          aria-label="Section title"
        />
      </div>

      {/* Section ID */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-text-dim, #6b7280)' }}>
          section_id
        </label>
        <div className="flex items-center gap-2">
          <span
            className="border rounded px-3 py-2 text-sm font-mono flex-1"
            style={{ background: 'var(--c-surface-2, #f3f4f6)', color: 'var(--c-text-dim, #6b7280)' }}
          >
            {section.section_id}
          </span>
          <button
            className="text-xs px-2 py-2 rounded border"
            style={{ borderColor: 'var(--c-border, #e5e7eb)', color: 'var(--c-text-dim, #6b7280)' }}
            title="Regenerate section_id from title"
            onClick={() =>
              builder.updateSection(section.section_id, {
                section_id: slugify(section.title) || section.section_id,
              })
            }
          >
            ↺ Regenerate from title
          </button>
        </div>
      </div>

      {/* Fields list */}
      <div className="flex flex-col gap-2 flex-1 overflow-y-auto min-h-0">
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--c-text-dim, #6b7280)' }}>
          Fields ({section.fields.length})
        </div>

        {section.fields.length === 0 ? (
          <div
            className="rounded border border-dashed flex items-center justify-center py-8 text-sm"
            style={{ borderColor: 'var(--c-border, #e5e7eb)', color: 'var(--c-text-dim, #6b7280)' }}
          >
            No fields yet. Add one below.
          </div>
        ) : (
          <ul className="space-y-1">
            {section.fields.map((field: SectionField, idx: number) => {
              const isSelected = field.field_id === selectedFieldId;
              return (
                <li key={field.field_id} className="flex flex-col gap-0">
                  {/* Field row */}
                  <div
                    className={[
                      'group flex items-center gap-2 rounded border px-3 py-2 text-sm cursor-pointer transition-colors',
                      isSelected
                        ? 'border-blue-400 bg-blue-50'
                        : 'hover:border-blue-200 hover:bg-gray-50',
                    ].join(' ')}
                    style={{
                      borderColor: isSelected ? undefined : 'var(--c-border, #e5e7eb)',
                      background: isSelected ? undefined : 'var(--c-surface-1, #fff)',
                    }}
                    onClick={() => setSelectedFieldId(isSelected ? null : field.field_id)}
                  >
                    <span className="font-mono text-xs truncate flex-1" style={{ color: 'var(--c-text-dim, #6b7280)' }}>
                      {field.field_id}
                    </span>
                    <span
                      className="text-xs rounded px-1.5 py-0.5 shrink-0"
                      style={{ background: 'var(--c-surface-2, #f3f4f6)', color: 'var(--c-text-dim, #6b7280)' }}
                    >
                      {field.type}
                    </span>
                    <span className="text-xs truncate max-w-32 shrink-0">{field.label}</span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                      <button
                        className="text-xs px-1 py-0.5 rounded hover:bg-gray-200 disabled:opacity-30"
                        title="Move up"
                        disabled={idx === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          builder.moveField(section.section_id, field.field_id, 'up');
                        }}
                      >
                        ↑
                      </button>
                      <button
                        className="text-xs px-1 py-0.5 rounded hover:bg-gray-200 disabled:opacity-30"
                        title="Move down"
                        disabled={idx === section.fields.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          builder.moveField(section.section_id, field.field_id, 'down');
                        }}
                      >
                        ↓
                      </button>
                      <button
                        className="text-xs px-1 py-0.5 rounded hover:bg-red-100"
                        title="Remove field"
                        style={{ color: 'var(--c-danger, #ef4444)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFieldRemove(field.field_id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {/* Inline editor — shown when the field row is selected */}
                  {isSelected && selectedField && (
                    <div className="ml-3 mt-1 mb-2">
                      <FieldEditor
                        sectionId={section.section_id}
                        field={selectedField}
                        sectionFields={section.fields as Field[]}
                        onChange={(patch) => handleFieldChange(field.field_id, patch)}
                        onRemove={() => handleFieldRemove(field.field_id)}
                      />
                      <button
                        type="button"
                        className="mt-2 text-xs px-2 py-1 rounded border"
                        style={{ borderColor: 'var(--c-border, #e5e7eb)', color: 'var(--c-text-dim, #6b7280)' }}
                        onClick={() => setSelectedFieldId(null)}
                      >
                        Close editor
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Add field button */}
      <div className="pt-2 border-t">
        <button
          type="button"
          className="w-full text-sm py-2 rounded border border-dashed transition-colors hover:border-blue-400 hover:bg-blue-50"
          style={{ borderColor: 'var(--c-border, #e5e7eb)', color: 'var(--c-text-dim, #6b7280)' }}
          onClick={() => setShowPicker(true)}
        >
          + Add field
        </button>
      </div>

      {/* Field type picker modal */}
      {showPicker && (
        <FieldTypePicker
          onSelect={handleFieldTypeChosen}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
