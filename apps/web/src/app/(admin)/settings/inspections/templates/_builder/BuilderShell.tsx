'use client';
import { useState, useEffect } from 'react';
import type { useBuilderState } from './useBuilderState';
import { MetadataHeader } from './MetadataHeader';
import { SectionsList } from './SectionsList';
import { SectionEditor } from './SectionEditor';

interface Props {
  builder: ReturnType<typeof useBuilderState>;
}

export function BuilderShell({ builder }: Props) {
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const sections = builder.state.sections ?? [];

  // Auto-select first section when sections become non-empty and nothing is selected.
  // Also clear selection if the selected section was deleted.
  useEffect(() => {
    if (selectedSectionId === null && sections.length > 0) {
      setSelectedSectionId(sections[0].section_id);
      return;
    }
    if (selectedSectionId !== null && !sections.find((s) => s.section_id === selectedSectionId)) {
      setSelectedSectionId(sections.length > 0 ? sections[0].section_id : null);
    }
  }, [sections, selectedSectionId]);

  function handleAddAndSelect() {
    builder.addSection();
    // The reducer assigns `section_${sections.length + 1}` to the new section.
    const newId = `section_${sections.length + 1}`;
    setSelectedSectionId(newId);
  }

  return (
    <div className="flex flex-col h-screen">
      <MetadataHeader state={builder.state} onChange={builder.setMetadata} />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 border-r p-4 overflow-y-auto flex flex-col">
          <SectionsList
            sections={sections}
            selectedSectionId={selectedSectionId}
            onSelect={setSelectedSectionId}
            builder={builder}
            onAddAndSelect={handleAddAndSelect}
          />
        </aside>
        <main className="flex-1 p-6 overflow-y-auto flex flex-col">
          <SectionEditor
            sections={sections}
            selectedSectionId={selectedSectionId}
            builder={builder}
          />
        </main>
        <aside className="w-96 border-l p-4 overflow-y-auto">
          {/* PreviewPane — placeholder until D.2 */}
          <div className="text-sm" style={{ color: 'var(--c-muted, #6b7280)' }}>
            Live preview (D.2 will fill this)
          </div>
        </aside>
      </div>
    </div>
  );
}
