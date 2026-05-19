'use client';
import type { TemplateDraft } from './useBuilderState';
import type { useBuilderState } from './useBuilderState';

type Section = TemplateDraft['sections'][number];
type SectionField = Section['fields'][number];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

interface Props {
  sections: Section[];
  selectedSectionId: string | null;
  builder: Pick<ReturnType<typeof useBuilderState>, 'updateSection' | 'removeField' | 'moveField'>;
}

export function SectionEditor({ sections, selectedSectionId, builder }: Props) {
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
      <div className="flex flex-col gap-2 flex-1 overflow-y-auto">
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
            {section.fields.map((field: SectionField, idx: number) => (
              <li
                key={field.field_id}
                className="group flex items-center gap-2 rounded border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--c-border, #e5e7eb)', background: 'var(--c-surface-1, #fff)' }}
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
                    onClick={() => builder.moveField(section.section_id, field.field_id, 'up')}
                  >
                    ↑
                  </button>
                  <button
                    className="text-xs px-1 py-0.5 rounded hover:bg-gray-200 disabled:opacity-30"
                    title="Move down"
                    disabled={idx === section.fields.length - 1}
                    onClick={() => builder.moveField(section.section_id, field.field_id, 'down')}
                  >
                    ↓
                  </button>
                  <button
                    className="text-xs px-1 py-0.5 rounded hover:bg-red-100"
                    title="Remove field"
                    style={{ color: 'var(--c-danger, #ef4444)' }}
                    onClick={() => {
                      if (confirm(`Remove field "${field.field_id}"?`)) {
                        builder.removeField(section.section_id, field.field_id);
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add field stub */}
      <div className="pt-2 border-t">
        <button
          className="w-full text-sm py-2 rounded border border-dashed opacity-50 cursor-not-allowed"
          style={{ borderColor: 'var(--c-border, #e5e7eb)', color: 'var(--c-text-dim, #6b7280)' }}
          disabled
          title="Field type picker arrives in Phase B"
        >
          + Add field — coming in Phase B
        </button>
      </div>
    </div>
  );
}
