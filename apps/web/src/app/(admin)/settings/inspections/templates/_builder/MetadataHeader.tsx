'use client';
import type { TemplateDraft } from './useBuilderState';

interface Props {
  state: Partial<TemplateDraft>;
  onChange: (
    patch: Partial<
      Pick<
        TemplateDraft,
        | 'template_id'
        | 'version'
        | 'name'
        | 'deliverable_type'
        | 'sans_reference'
        | 'branding'
        | 'applies_to_node_types'
        | 'node_subtypes'
        | 'requires_separate_verifier'
      >
    >
  ) => void;
}

export function MetadataHeader({ state, onChange }: Props) {
  return (
    <header className="border-b p-4 flex items-center gap-3 flex-wrap">
      <input
        type="text"
        placeholder="Template name (e.g. Generator FAT)"
        value={state.name ?? ''}
        onChange={(e) => onChange({ name: e.target.value })}
        className="border rounded px-3 py-2 text-base flex-1 min-w-64"
        aria-label="Template name"
      />
      <input
        type="text"
        placeholder="template_id (slug, e.g. generator-fat)"
        value={state.template_id ?? ''}
        onChange={(e) => onChange({ template_id: e.target.value })}
        className="border rounded px-3 py-2 text-sm w-48 font-mono"
        aria-label="Template ID"
      />
      <input
        type="text"
        placeholder="1.0"
        value={state.version ?? ''}
        onChange={(e) => onChange({ version: e.target.value })}
        className="border rounded px-3 py-2 text-sm w-20 font-mono"
        aria-label="Version"
      />
      <select
        value={state.deliverable_type ?? 'inspection_only'}
        onChange={(e) =>
          onChange({
            deliverable_type: e.target.value as TemplateDraft['deliverable_type'],
          })
        }
        className="border rounded px-3 py-2 text-sm"
        aria-label="Deliverable type"
      >
        <option value="coc">COC (Certificate of Compliance)</option>
        <option value="inspection_only">Inspection only</option>
        <option value="factory_test">Factory acceptance test</option>
      </select>
      <input
        type="text"
        placeholder="SANS / IEC reference (optional)"
        value={state.sans_reference ?? ''}
        onChange={(e) => onChange({ sans_reference: e.target.value || undefined })}
        className="border rounded px-3 py-2 text-sm flex-1 min-w-48"
        aria-label="SANS / IEC reference"
      />
    </header>
  );
}
