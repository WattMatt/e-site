'use client';
import type { TemplateDraft } from './useBuilderState';
import type { useBuilderState } from './useBuilderState';

type Section = TemplateDraft['sections'][number];

interface Props {
  sections: Section[];
  selectedSectionId: string | null;
  onSelect: (sectionId: string) => void;
  builder: Pick<ReturnType<typeof useBuilderState>, 'addSection' | 'removeSection' | 'moveSection'>;
  onAddAndSelect: () => void;
}

export function SectionsList({ sections, selectedSectionId, onSelect, builder, onAddAndSelect }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-dim, #6b7280)' }}>
        Sections
      </div>

      {sections.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center">
          <p className="text-sm" style={{ color: 'var(--c-text-dim, #6b7280)' }}>
            No sections yet.<br />Add one to start.
          </p>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto space-y-1">
          {sections.map((section, idx) => {
            const isActive = section.section_id === selectedSectionId;
            return (
              <li
                key={section.section_id}
                className="group rounded px-2 py-2 cursor-pointer flex items-center gap-1"
                style={{
                  background: isActive ? 'var(--c-amber-dim, #fef3c7)' : undefined,
                  border: isActive ? '1px solid var(--c-amber, #f59e0b)' : '1px solid transparent',
                }}
                onClick={() => onSelect(section.section_id)}
              >
                <span className="flex-1 text-sm truncate font-medium">{section.title || 'Untitled section'}</span>
                <span
                  className="text-xs rounded px-1 shrink-0"
                  style={{
                    background: 'var(--c-surface-2, #f3f4f6)',
                    color: 'var(--c-text-dim, #6b7280)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {section.fields.length}
                </span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="text-xs leading-none px-1 py-0.5 rounded hover:bg-[var(--c-elevated)] disabled:opacity-30"
                    title="Move up"
                    disabled={idx === 0}
                    onClick={() => builder.moveSection(section.section_id, 'up')}
                  >
                    ↑
                  </button>
                  <button
                    className="text-xs leading-none px-1 py-0.5 rounded hover:bg-[var(--c-elevated)] disabled:opacity-30"
                    title="Move down"
                    disabled={idx === sections.length - 1}
                    onClick={() => builder.moveSection(section.section_id, 'down')}
                  >
                    ↓
                  </button>
                  <button
                    className="text-xs leading-none px-1 py-0.5 rounded hover:bg-[var(--c-red-dim)]"
                    title="Delete section"
                    style={{ color: 'var(--c-danger, #ef4444)' }}
                    onClick={() => {
                      if (confirm(`Delete section "${section.title || 'Untitled'}"? Fields will be lost.`)) {
                        builder.removeSection(section.section_id);
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="pt-2 border-t mt-2">
        <button
          className="w-full text-sm py-2 rounded border border-dashed"
          style={{
            borderColor: 'var(--c-amber, #f59e0b)',
            color: 'var(--c-amber, #f59e0b)',
          }}
          onClick={onAddAndSelect}
        >
          + Add section
        </button>
      </div>
    </div>
  );
}
