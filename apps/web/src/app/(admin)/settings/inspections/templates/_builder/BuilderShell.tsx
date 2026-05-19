'use client';
import type { useBuilderState } from './useBuilderState';
import { MetadataHeader } from './MetadataHeader';

// SectionsList, SectionEditor, and PreviewPane will be added in A.3 and D.2.

interface Props {
  builder: ReturnType<typeof useBuilderState>;
}

export function BuilderShell({ builder }: Props) {
  return (
    <div className="flex flex-col h-screen">
      <MetadataHeader state={builder.state} onChange={builder.setMetadata} />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 border-r p-4 overflow-y-auto">
          {/* SectionsList — placeholder until A.3 */}
          <div className="text-sm" style={{ color: 'var(--c-muted, #6b7280)' }}>
            Sections list (A.3 will fill this)
          </div>
        </aside>
        <main className="flex-1 p-6 overflow-y-auto">
          {/* SectionEditor — placeholder until A.3 */}
          <div className="text-sm" style={{ color: 'var(--c-muted, #6b7280)' }}>
            Section editor (A.3 will fill this)
          </div>
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
