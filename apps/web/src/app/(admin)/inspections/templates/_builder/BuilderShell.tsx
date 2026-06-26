'use client';
import { useState, useEffect } from 'react';
import type { useBuilderState } from './useBuilderState';
import { MetadataHeader } from './MetadataHeader';
import { SectionsList } from './SectionsList';
import { SectionEditor } from './SectionEditor';
import { JsonPreviewPanel } from './JsonPreviewPanel';
import { PreviewPane } from './PreviewPane';
import { SavePanel } from './SavePanel';

interface Props {
  builder: ReturnType<typeof useBuilderState>;
  onSave?: (draft: unknown) => Promise<{ ok: boolean; error?: string }>;
}

export function BuilderShell({ builder, onSave }: Props) {
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'preview' | 'json'>('preview');
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
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => setRightTab('preview')}
              className={`px-3 py-1 text-sm rounded ${rightTab === 'preview' ? 'bg-[var(--c-blue-dim)] text-[var(--c-blue)]' : 'bg-[var(--c-surface)] text-[var(--c-text-dim)] hover:bg-[var(--c-elevated)]'}`}
            >
              Live preview
            </button>
            <button
              type="button"
              onClick={() => setRightTab('json')}
              className={`px-3 py-1 text-sm rounded ${rightTab === 'json' ? 'bg-[var(--c-blue-dim)] text-[var(--c-blue)]' : 'bg-[var(--c-surface)] text-[var(--c-text-dim)] hover:bg-[var(--c-elevated)]'}`}
            >
              JSON
            </button>
          </div>
          {rightTab === 'preview' ? (
            <PreviewPane draft={builder.state} />
          ) : (
            <JsonPreviewPanel draft={builder.state} />
          )}
        </aside>
      </div>
      <SavePanel draft={builder.state} onSave={onSave} />
    </div>
  );
}
